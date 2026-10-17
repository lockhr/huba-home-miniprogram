// 情侣空间的配对与生命周期。所有共享读写都由 service.js 按 spaceId 隔离，
// 这里只负责「身份属于哪个空间」这件事。
const crypto = require('node:crypto')
const {
  ALLOWED_MOODS,
  DEFAULT_AVATAR_KEY,
  INVITE_TTL_MS,
  MAX_SPACE_MEMBERS,
  compact,
  fail,
  validateAnniversary,
  validateAvatarKey,
  validateDisplayName,
  validateSpaceImage,
  validateSpaceName,
} = require('./shared.js')
const { safeAppearanceOf, safeAvatarFileId } = require('./appearance.js')

const DEFAULT_FEATURES = { schedule: false, dinner: true, records: true, xiaoba: false }
const PURGE_BATCH_SIZE = 20
const PURGE_COLLECTIONS_V1 = [
  'SpaceFileList',
  'MissionList',
  'MarketList',
  'StorageList',
  'HouseRuleList',
  'MenuList',
  'DinnerOrderList',
  'MemoryPostList',
  'WishList',
  'ScheduleList',
  'PairInviteList',
]
const PURGE_COLLECTIONS = [
  'MissionList',
  'MarketList',
  'StorageList',
  'HouseRuleList',
  'MenuList',
  'DinnerOrderList',
  'MemoryPostList',
  'WishList',
  'ScheduleList',
  'PairInviteList',
  'SpaceFileList',
]

// 邀请标识至少 32 字节随机，数据库只保存摘要（设计稿 §5.3）。
function newInviteToken() {
  return crypto.randomBytes(32).toString('base64url')
}

function inviteDigest(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function createSpaceManager(store, now = () => new Date(), options = {}) {
  const capabilities = { schedule: false, xiaoba: false, ...(options.capabilities || {}) }
  const deploymentFeatures = {
    ...DEFAULT_FEATURES,
    schedule: capabilities.schedule === true,
    xiaoba: capabilities.xiaoba === true,
  }
  const contentSafetyRequired = options.contentSafetyRequired === true
  const moderateText = typeof options.moderateText === 'function' ? options.moderateText : null
  async function requireSafeText(...values) {
    const content = values.filter(value => typeof value === 'string' && value.trim()).join('\n').trim()
    if (!content) return
    if (!moderateText) {
      if (contentSafetyRequired) fail('CONTENT_CHECK_UNAVAILABLE')
      return
    }
    try {
      await moderateText(content)
    } catch (error) {
      if (error && error.code === 'CONTENT_REJECTED') fail('CONTENT_REJECTED')
      fail('CONTENT_CHECK_UNAVAILABLE')
    }
  }
  const deleteFiles = typeof options.deleteFiles === 'function' ? options.deleteFiles : null
  // index.js 传来的 now() 在真实环境里是 db.serverDate() 的命令对象，不是 Date。
  // 这里统一退回到本机时间，避免算出 Invalid Date。
  function nowDate() {
    const value = now()
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? new Date() : date
  }

  function stamp() {
    return nowDate().toISOString()
  }

  function expiresAt() {
    return new Date(nowDate().getTime() + INVITE_TTL_MS).toISOString()
  }

  async function spaceOf(user) {
    if (!user || (user.memberStatus && user.memberStatus !== 'active') || typeof user.spaceId !== 'string' || !user.spaceId) return null
    return (await store.getById('CoupleSpaceList', user.spaceId)) || null
  }

  async function membersOf(spaceId, source = store, candidates = null) {
    // CloudBase transactions support doc(id), not collection.where(). Query IDs
    // before opening the transaction, then re-read those documents transactionally.
    const selected = candidates || (source === store ? await store.findMany('UserList', { spaceId }) : null)
    if (!selected) throw new Error('transaction member candidates must be loaded before the transaction')
    const members = source === store ? selected : await Promise.all(
      selected.map(user => source.getById('UserList', user._id)),
    )
    return members.filter(user => user && user.spaceId === spaceId && user.memberStatus === 'active')
  }

  // 返回给页面的成员视图。canEditMood / canSyncSteps 由服务端判定，
  // 页面不再靠比较 openid 猜「谁是我」。
  //
  // `openid` 是 M3 之后页面统一使用的字段；`_openid` / `reminderReady` /
  // `reminderGrantedAt` 是 getUsers 这条旧接口的兼容字段，等 M3 把页面
  // 全部切到 getBootstrap 之后再删。
  function onboardingState(user) {
    const profileComplete = Boolean(compact(user && user.displayName))
    const migratedLegacyProfile = profileComplete && !user.createdAt
    const identityNoticeRequired = !user.identityNoticeAcceptedAt && !migratedLegacyProfile
    return {
      profileComplete,
      identityNoticeRequired,
      onboardingComplete: profileComplete && !identityNoticeRequired,
    }
  }

  function userView(user, callerOpenid, spaceId = '') {
    const mine = user._openid === callerOpenid
    const onboarding = onboardingState(user)
    const credits = Number.isSafeInteger(user.reminderCredits) && user.reminderCredits >= 0
      ? user.reminderCredits
      : (user.reminderReady === true ? 1 : 0)
    return {
      registered: Boolean(user && user._id),
      openid: user._openid,
      _openid: user._openid,
      displayName: compact(user.displayName) || (mine ? '我' : '对方'),
      avatarKey: typeof user.avatarKey === 'string' && user.avatarKey ? user.avatarKey : DEFAULT_AVATAR_KEY,
      avatarFileId: safeAvatarFileId(user, spaceId),
      // 默认头像本身就是合法选择；是否完成首次资料以真实保存过的昵称为准。
      // 必须显式下发，客户端不能从展示兜底“我 / 对方”反推资料状态。
      profileComplete: onboarding.profileComplete,
      identityNoticeRequired: onboarding.identityNoticeRequired,
      onboardingComplete: onboarding.onboardingComplete,
      credit: Number(user.credit) || 0,
      mood: ALLOWED_MOODS.has(user.mood) ? user.mood : 'calm',
      moodUpdatedAt: user.moodUpdatedAt || null,
      steps: Number.isSafeInteger(user.steps) && user.steps >= 0 ? user.steps : 0,
      stepsDate: typeof user.stepsDate === 'string' ? user.stepsDate : '',
      stepsUpdatedAt: user.stepsUpdatedAt || null,
      reminderReady: credits > 0,
      reminderCredits: credits,
      reminderGrantedAt: user.reminderGrantedAt || null,
      canEditMood: mine,
      canSyncSteps: mine,
    }
  }

  function requireCompletedOnboarding(user) {
    const onboarding = onboardingState(user)
    if (!onboarding.profileComplete) fail('PROFILE_REQUIRED')
    if (onboarding.identityNoticeRequired) fail('IDENTITY_NOTICE_REQUIRED')
    return onboarding
  }

  function deletionView(space, callerOpenid) {
    const deletion = space && space.deletion
    if (!deletion || typeof deletion !== 'object') {
      return space && space.status === 'deleting'
        ? { phase: 'legacy', legacy: true, canRestore: true }
        : null
    }
    const approvedBy = Array.isArray(deletion.approvedBy) ? deletion.approvedBy : []
    const phase = compact(deletion.phase)
    const isRequester = deletion.requestedBy === callerOpenid
    const hasApproved = approvedBy.includes(callerOpenid)
    const cooldownEndsAt = compact(deletion.cooldownEndsAt)
    return {
      operationId: compact(deletion.operationId),
      phase,
      legacy: false,
      isRequester,
      hasApproved,
      canApprove: phase === 'awaiting_partner' && !isRequester && !hasApproved,
      canReject: phase === 'awaiting_partner' && !isRequester,
      canCancel: (phase === 'awaiting_partner' && isRequester) || phase === 'cooldown',
      canFinalize: phase === 'cooldown',
      cooldownEndsAt,
      progress: phase === 'purging' && deletion.progress && typeof deletion.progress === 'object'
        ? { ...deletion.progress }
        : null,
    }
  }

  function spaceView(space, callerOpenid) {
    const features = { ...deploymentFeatures }
    const flags = space.featureFlags && typeof space.featureFlags === 'object' ? space.featureFlags : {}
    for (const key of Object.keys(DEFAULT_FEATURES)) {
      if (flags[key] === false) features[key] = false
    }
    return {
      _id: space._id,
      name: compact(space.name),
      anniversaryDate: compact(space.anniversaryDate),
      status: space.status,
      deletion: deletionView(space, callerOpenid),
      features,
    }
  }

  async function bootstrap(caller) {
    let space = await spaceOf(caller)
    if (!space) {
      return {
        state: 'unpaired',
        user: userView(caller, caller._openid),
        partner: null,
        space: null,
        features: { ...deploymentFeatures },
      }
    }
    // 兼容上一版已经写入 awaiting/cooldown/purging、但还没有 operationId 的在途状态。
    // 只补标识，不改变 phase/progress，更不能把 purging 恢复成 active。
    if (space.deletion && typeof space.deletion === 'object' && !compact(space.deletion.operationId)) {
      space = await store.runTransaction(async transaction => {
        const current = await transaction.getById('CoupleSpaceList', space._id)
        if (!current) fail('NO_SPACE')
        if (!current.deletion || typeof current.deletion !== 'object' || compact(current.deletion.operationId)) return current
        const deletion = { ...current.deletion, operationId: crypto.randomBytes(16).toString('hex') }
        await transaction.updateById('CoupleSpaceList', current._id, { deletion, updatedAt: stamp() }, { replaceObjectFields: ['deletion'] })
        return { ...current, deletion }
      })
    }
    const members = await membersOf(space._id)
    const partner = members.find(user => user._openid !== caller._openid) || null
    const state = space.status === 'frozen' ? 'frozen' : space.status === 'deleting' ? 'deleting' : 'ready'
    const view = spaceView(space, caller._openid)
    return {
      state,
      user: userView(caller, caller._openid, space._id),
      partner: partner ? userView(partner, caller._openid, space._id) : null,
      space: {
        _id: view._id,
        name: view.name,
        anniversaryDate: view.anniversaryDate,
        status: view.status,
        deletion: view.deletion,
        appearance: safeAppearanceOf(space),
      },
      features: view.features,
    }
  }

  async function updateProfile(caller, input = {}) {
    const onboarding = onboardingState(caller)
    if (onboarding.identityNoticeRequired && input.identityNoticeAccepted !== true) fail('IDENTITY_NOTICE_REQUIRED')
    const displayName = validateDisplayName(input.displayName)
    await requireSafeText(displayName)
    const avatarKey = validateAvatarKey(input.avatarKey)
    const patch = { displayName, avatarKey, updatedAt: stamp() }
    if (onboarding.identityNoticeRequired) {
      patch.identityNoticeVersion = 1
      patch.identityNoticeAcceptedAt = stamp()
    }
    await store.updateById('UserList', caller._id, patch)
    return { displayName, avatarKey }
  }

  async function createSpace(caller, input = {}) {
    const name = validateSpaceName(input.name)
    await requireSafeText(name)
    const anniversaryDate = validateAnniversary(input.anniversaryDate, nowDate())
    requireCompletedOnboarding(caller)
    if (await spaceOf(caller)) fail('ALREADY_PAIRED')

    return store.runTransaction(async transaction => {
      const fresh = await transaction.getById('UserList', caller._id)
      if (!fresh || fresh._openid !== caller._openid) fail('UNAUTHORIZED')
      requireCompletedOnboarding(fresh)
      if (fresh.memberStatus !== 'left' && typeof fresh.spaceId === 'string' && fresh.spaceId) fail('ALREADY_PAIRED')

      const createdAt = stamp()
      const space = await transaction.add('CoupleSpaceList', {
        name,
        anniversaryDate,
        status: 'active',
        featureFlags: {},
        createdBy: caller._openid,
        membershipEpoch: crypto.randomBytes(16).toString('hex'),
        createdAt,
        updatedAt: createdAt,
      })
      await transaction.updateById('UserList', caller._id, {
        spaceId: space._id,
        memberStatus: 'active',
        updatedAt: createdAt,
      })

      const token = newInviteToken()
      const expires = expiresAt()
      await transaction.add('PairInviteList', {
        spaceId: space._id,
        inviterOpenid: caller._openid,
        tokenDigest: inviteDigest(token),
        status: 'active',
        expiresAt: expires,
        usedBy: '',
        usedAt: null,
        createdAt,
      })
      return { spaceId: space._id, inviteToken: token, expiresAt: expires }
    })
  }

  // 邀请解析只做「能不能用」的判断，不返回空间内任何业务内容。
  async function resolveInvite(token) {
    const text = compact(token)
    if (!text) return { status: 'missing' }
    const invite = await store.findOne('PairInviteList', { tokenDigest: inviteDigest(text) })
    if (!invite) return { status: 'missing' }
    if (invite.status === 'used') return { status: 'used' }
    if (invite.status !== 'active') return { status: 'missing' }
    if (!(new Date(invite.expiresAt).getTime() > nowDate().getTime())) return { status: 'expired' }
    const space = await store.getById('CoupleSpaceList', invite.spaceId)
    if (!space) return { status: 'missing' }
    return { status: 'space', invite, space }
  }

  async function getInvite(caller, input = {}) {
    const resolved = await resolveInvite(input.inviteToken)
    const blank = { spaceName: '', inviterName: '' }
    if (resolved.status !== 'space') return { status: resolved.status, ...blank }
    const { invite, space } = resolved
    if (space.status !== 'active') return { status: 'missing', ...blank }
    // 已经在别的空间里：先引导处理原空间关系（设计稿 §8）。
    if (caller.memberStatus !== 'left' && compact(caller.spaceId)) return { status: 'occupied', ...blank }
    const members = await membersOf(space._id)
    if (members.length >= MAX_SPACE_MEMBERS) return { status: 'full', ...blank }
    const inviter = members.find(user => user._openid === invite.inviterOpenid) || null
    return {
      status: 'valid',
      spaceName: compact(space.name),
      inviterName: inviter ? (compact(inviter.displayName) || '对方') : '对方',
    }
  }

  async function joinSpace(caller, input = {}) {
    // 首次资料没有完成时先停在设置页；必须在解析邀请前拦截，
    // 既不消耗邀请，也不向空资料账号透露邀请状态。
    requireCompletedOnboarding(caller)
    const resolved = await resolveInvite(input.inviteToken)
    if (resolved.status === 'missing') fail('INVALID_INVITE')
    if (resolved.status === 'expired') fail('INVITE_EXPIRED')
    if (resolved.status === 'used') fail('INVITE_USED')
    const space = resolved.space
    if (space.status === 'frozen') fail('SPACE_FROZEN')
    if (space.status !== 'active') fail('SPACE_DELETING')
    const memberCandidates = await store.findMany('UserList', { spaceId: space._id })

    // 事务内重新校验一次，保证同一邀请只会配对成功一个人。
    return store.runTransaction(async transaction => {
      const digest = inviteDigest(compact(input.inviteToken))
      const freshCaller = await transaction.getById('UserList', caller._id)
      if (!freshCaller || freshCaller._openid !== caller._openid) fail('UNAUTHORIZED')
      requireCompletedOnboarding(freshCaller)
      if (freshCaller.memberStatus !== 'left' && compact(freshCaller.spaceId)) fail('ALREADY_PAIRED')

      const freshInvite = await transaction.getById('PairInviteList', resolved.invite._id)
      if (!freshInvite) fail('INVALID_INVITE')
      if (freshInvite.tokenDigest !== digest) fail('INVALID_INVITE')
      if (freshInvite.status === 'used') fail('INVITE_USED')
      if (freshInvite.status !== 'active') fail('INVALID_INVITE')
      if (!(new Date(freshInvite.expiresAt).getTime() > nowDate().getTime())) fail('INVITE_EXPIRED')

      const freshSpace = await transaction.getById('CoupleSpaceList', freshInvite.spaceId)
      if (!freshSpace) fail('INVALID_INVITE')
      if (freshSpace.membershipEpoch !== space.membershipEpoch) fail('DELETION_OPERATION_STALE')
      if (freshSpace.status === 'frozen') fail('SPACE_FROZEN')
      if (freshSpace.status !== 'active') fail('SPACE_DELETING')

      const members = await membersOf(freshInvite.spaceId, transaction, memberCandidates)
      if (members.length >= MAX_SPACE_MEMBERS) fail('SPACE_FULL')
      if (members.some(user => user._openid === caller._openid)) fail('ALREADY_PAIRED')

      const at = stamp()
      await transaction.updateById('UserList', caller._id, {
        spaceId: freshInvite.spaceId,
        memberStatus: 'active',
        updatedAt: at,
      })
      await transaction.updateById('PairInviteList', freshInvite._id, {
        status: 'used',
        usedBy: caller._openid,
        usedAt: at,
      })
      // Serialize membership changes with deletion, which also writes the space.
      await transaction.updateById('CoupleSpaceList', freshSpace._id, { membershipEpoch: crypto.randomBytes(16).toString('hex'), updatedAt: at })
      return { spaceId: freshInvite.spaceId }
    })
  }

  async function requireOwnSpace(caller) {
    const space = await spaceOf(caller)
    if (!space) fail('NO_SPACE')
    return space
  }

  async function regenerateInvite(caller) {
    const space = await requireOwnSpace(caller)
    if (space.status !== 'active') fail(space.status === 'frozen' ? 'SPACE_FROZEN' : 'SPACE_DELETING')
    const inviteCandidates = await store.findMany('PairInviteList', { spaceId: space._id, status: 'active' })
    const memberCandidates = await store.findMany('UserList', { spaceId: space._id })
    return store.runTransaction(async transaction => {
      const freshCaller = await transaction.getById('UserList', caller._id)
      if (!freshCaller || freshCaller._openid !== caller._openid) fail('UNAUTHORIZED')
      if (freshCaller.spaceId !== space._id || freshCaller.memberStatus !== 'active') fail('NO_SPACE')
      const freshSpace = await transaction.getById('CoupleSpaceList', space._id)
      if (!freshSpace) fail('NO_SPACE')
      if (freshSpace.membershipEpoch !== space.membershipEpoch) fail('DELETION_OPERATION_STALE')
      if (freshSpace.status !== 'active') fail(freshSpace.status === 'frozen' ? 'SPACE_FROZEN' : 'SPACE_DELETING')
      if ((await membersOf(space._id, transaction, memberCandidates)).length >= MAX_SPACE_MEMBERS) fail('SPACE_FULL')
      for (const candidate of inviteCandidates) {
        const invite = await transaction.getById('PairInviteList', candidate._id)
        if (invite && invite.spaceId === space._id && invite.status === 'active') {
          await transaction.updateById('PairInviteList', invite._id, { status: 'revoked' })
        }
      }
      const token = newInviteToken()
      const expires = expiresAt()
      await transaction.add('PairInviteList', {
        spaceId: space._id,
        inviterOpenid: caller._openid,
        tokenDigest: inviteDigest(token),
        status: 'active',
        expiresAt: expires,
        usedBy: '',
        usedAt: null,
        createdAt: stamp(),
      })
      await transaction.updateById('CoupleSpaceList', space._id, { updatedAt: stamp() })
      return { inviteToken: token, expiresAt: expires }
    })
  }

  async function updateSpace(caller, input = {}) {
    const space = await requireOwnSpace(caller)
    if (space.status === 'frozen') fail('SPACE_FROZEN')
    if (space.status !== 'active') fail('SPACE_DELETING')
    const patch = { updatedAt: stamp() }
    if (input.name !== undefined) patch.name = validateSpaceName(input.name)
    if (patch.name) await requireSafeText(patch.name)
    if (input.anniversaryDate !== undefined) patch.anniversaryDate = validateAnniversary(input.anniversaryDate, nowDate())
    await store.runTransaction(async transaction => {
      const freshCaller = await transaction.getById('UserList', caller._id)
      if (!freshCaller || freshCaller._openid !== caller._openid || freshCaller.spaceId !== space._id) fail('NO_SPACE')
      const freshSpace = await transaction.getById('CoupleSpaceList', space._id)
      if (!freshSpace) fail('NO_SPACE')
      if (freshSpace.status !== 'active') fail(freshSpace.status === 'frozen' ? 'SPACE_FROZEN' : 'SPACE_DELETING')
      await transaction.updateById('CoupleSpaceList', space._id, patch)
    })
    const fresh = await store.getById('CoupleSpaceList', space._id)
    return { name: compact(fresh.name), anniversaryDate: compact(fresh.anniversaryDate) }
  }

  // 解除配对只让自己离开，空间和对方的内容保留（设计稿 §3）。
  async function unpair(caller) {
    const inviteCandidates = compact(caller.spaceId)
      ? await store.findMany('PairInviteList', { spaceId: caller.spaceId, status: 'active' })
      : []
    return runLifecycleTransaction(caller, async (transaction, { space, members }) => {
      if (space.status === 'deleting') fail('SPACE_DELETING')
      if (members.length <= 1) fail('LAST_MEMBER_MUST_DELETE_SPACE')
      const at = stamp()
      if (space.deletion && space.deletion.phase === 'awaiting_partner') {
        await transaction.updateById('CoupleSpaceList', space._id, { deletion: null, updatedAt: at }, { replaceObjectFields: ['deletion'] })
      }
      for (const candidate of inviteCandidates) {
        const invite = await transaction.getById('PairInviteList', candidate._id)
        if (invite && invite.spaceId === space._id && invite.status === 'active') {
          await transaction.updateById('PairInviteList', invite._id, { status: 'revoked' })
        }
      }
      await transaction.updateById('UserList', caller._id, spaceMemberResetPatch(at))
      await transaction.updateById('CoupleSpaceList', space._id, { membershipEpoch: crypto.randomBytes(16).toString('hex'), updatedAt: at })
      return { removed: true, spaceId: space._id }
    })
  }

  function spaceMemberResetPatch(at) {
    return {
      spaceId: '', memberStatus: 'left', credit: 0,
      avatarFileId: '',
      mood: 'calm', moodUpdatedAt: null,
      steps: 0, stepsDate: '', stepsUpdatedAt: null,
      reminderCredits: 0, reminderReady: false, reminderGrantedAt: null,
      updatedAt: at,
    }
  }

  function lifecycleResult(space, callerOpenid) {
    return deletionView(space, callerOpenid) || { phase: 'none' }
  }

  async function lifecycleContext(source, caller, candidates = null, membershipEpoch = undefined) {
    const freshCaller = await source.getById('UserList', caller._id)
    if (!freshCaller || freshCaller._openid !== caller._openid || !compact(freshCaller.spaceId)) fail('NO_SPACE')
    const space = await source.getById('CoupleSpaceList', freshCaller.spaceId)
    if (!space) fail('NO_SPACE')
    if (candidates && space.membershipEpoch !== membershipEpoch) fail('DELETION_OPERATION_STALE')
    const members = await membersOf(space._id, source, candidates)
    if (!members.some(member => member._openid === caller._openid)) fail('UNAUTHORIZED')
    return { freshCaller, space, members }
  }

  async function runLifecycleTransaction(caller, callback) {
    if (!compact(caller.spaceId)) fail('NO_SPACE')
    const space = await store.getById('CoupleSpaceList', caller.spaceId)
    if (!space) fail('NO_SPACE')
    const candidates = await store.findMany('UserList', { spaceId: caller.spaceId })
    return store.runTransaction(async transaction => callback(
      transaction,
      await lifecycleContext(transaction, caller, candidates, space.membershipEpoch),
    ))
  }

  async function requestSpaceDeletion(caller) {
    let stage = 'PREPARE'
    try {
      return await runLifecycleTransaction(caller, async (transaction, { space, members }) => {
        stage = 'VALIDATE'
        if (space.deletion && typeof space.deletion === 'object') return lifecycleResult(space, caller._openid)
        if (space.status === 'deleting') fail('LEGACY_DELETION_RESTORE_REQUIRED')
        if (space.status !== 'active') fail('SPACE_FROZEN')
        const requestedAt = stamp()
        const operationId = crypto.randomBytes(16).toString('hex')
        const singleMember = members.length <= 1
        const deletion = {
          operationId,
          requestedBy: caller._openid,
          requestedAt,
          approvedBy: [caller._openid],
          phase: singleMember ? 'cooldown' : 'awaiting_partner',
          cooldownEndsAt: singleMember ? requestedAt : '',
          progress: null,
        }
        const updated = { ...space, status: singleMember ? 'deleting' : 'active', deletion, updatedAt: requestedAt }
        stage = 'WRITE_SPACE'
        await transaction.updateById('CoupleSpaceList', space._id, {
          status: updated.status,
          deletion,
          updatedAt: requestedAt,
        }, { replaceObjectFields: ['deletion'] })
        stage = 'COMMIT'
        return lifecycleResult(updated, caller._openid)
      })
    } catch (error) {
      if (error && typeof error === 'object') error.diagnosticStage = stage
      throw error
    }
  }

  function requireDeletionOperation(input, deletion) {
    const operationId = compact(input && input.operationId)
    if (!operationId || !deletion || operationId !== deletion.operationId) fail('DELETION_OPERATION_STALE')
    return operationId
  }

  function receiptOf(space, action, operationId, actorOpenid) {
    const receipts = Array.isArray(space && space.deletionReceipts) ? space.deletionReceipts : []
    return receipts.find(receipt => receipt && receipt.action === action && receipt.operationId === operationId && receipt.actorOpenid === actorOpenid) || null
  }

  function appendReceipt(space, action, operationId, actorOpenid, result) {
    const receipts = Array.isArray(space.deletionReceipts) ? space.deletionReceipts.slice(-9) : []
    return [...receipts, { action, operationId, actorOpenid, result, at: stamp() }]
  }

  async function approveSpaceDeletion(caller, input = {}) {
    return runLifecycleTransaction(caller, async (transaction, { space }) => {
      const operationId = compact(input.operationId)
      const receipt = receiptOf(space, 'approve', operationId, caller._openid)
      if (receipt) return receipt.result
      const deletion = space.deletion
      requireDeletionOperation(input, deletion)
      if (deletion && ['cooldown', 'purging'].includes(deletion.phase) && deletion.requestedBy !== caller._openid && Array.isArray(deletion.approvedBy) && deletion.approvedBy.includes(caller._openid)) return lifecycleResult(space, caller._openid)
      if (deletion && ['cooldown', 'purging'].includes(deletion.phase) && deletion.requestedBy === caller._openid) fail('DELETION_ALREADY_APPROVED')
      if (!deletion || deletion.phase !== 'awaiting_partner') fail('DELETION_NOT_AWAITING_APPROVAL')
      const approvedBy = Array.isArray(deletion.approvedBy) ? deletion.approvedBy : []
      if (deletion.requestedBy === caller._openid || approvedBy.includes(caller._openid)) fail('DELETION_ALREADY_APPROVED')
      const next = {
        ...deletion,
        approvedBy: [...approvedBy, caller._openid],
        phase: 'cooldown',
        cooldownEndsAt: stamp(),
      }
      const updated = { ...space, status: 'deleting', deletion: next, updatedAt: stamp() }
      const result = lifecycleResult(updated, caller._openid)
      await transaction.updateById('CoupleSpaceList', space._id, { status: 'deleting', deletion: next, deletionReceipts: appendReceipt(space, 'approve', operationId, caller._openid, result), updatedAt: updated.updatedAt }, { replaceObjectFields: ['deletion'] })
      return result
    })
  }

  async function clearDeletion(caller, mode, input = {}) {
    return runLifecycleTransaction(caller, async (transaction, { space }) => {
      const action = mode === 'reject' ? 'reject' : 'cancel'
      const operationId = compact(input.operationId)
      const receipt = receiptOf(space, action, operationId, caller._openid)
      if (receipt) return receipt.result
      const deletion = space.deletion
      requireDeletionOperation(input, deletion)
      if (!deletion || !['awaiting_partner', 'cooldown'].includes(deletion.phase)) fail('DELETION_NOT_CANCELLABLE')
      const requester = deletion.requestedBy === caller._openid
      if (deletion.phase === 'awaiting_partner') {
        if (mode === 'reject' && requester) fail('DELETION_REQUESTER_CANNOT_REJECT')
        if (mode === 'cancel' && !requester) fail('DELETION_PARTNER_MUST_REJECT')
      }
      const result = { phase: 'none', operationId }
      await transaction.updateById('CoupleSpaceList', space._id, { status: 'active', deletion: null, deletionReceipts: appendReceipt(space, action, operationId, caller._openid, result), updatedAt: stamp() }, { replaceObjectFields: ['deletion'] })
      return result
    })
  }

  const rejectSpaceDeletion = (caller, input) => clearDeletion(caller, 'reject', input)
  const cancelSpaceDeletion = (caller, input) => clearDeletion(caller, 'cancel', input)

  async function restoreLegacyDeletingSpace(caller) {
    return runLifecycleTransaction(caller, async (transaction, { space }) => {
      if (space.status === 'active' && !space.deletion) return { phase: 'none' }
      if (space.status !== 'deleting' || (space.deletion && typeof space.deletion === 'object')) fail('DELETION_NOT_LEGACY')
      await transaction.updateById('CoupleSpaceList', space._id, { status: 'active', deletion: null, updatedAt: stamp() })
      return { phase: 'none' }
    })
  }

  async function startSpacePurge(caller, input = {}) {
    return runLifecycleTransaction(caller, async (transaction, { space, members }) => {
      const deletion = space.deletion
      requireDeletionOperation(input, deletion)
      if (!deletion || !['cooldown', 'purging'].includes(deletion.phase)) fail('DELETION_NOT_READY')
      if (deletion.phase === 'purging') return lifecycleResult(space, caller._openid)
      const approvedBy = Array.isArray(deletion.approvedBy) ? deletion.approvedBy : []
      if (!members.length || members.some(member => !approvedBy.includes(member._openid))) fail('DELETION_NOT_READY')
      const next = { ...deletion, phase: 'purging', progress: { orderVersion: 2, collectionIndex: 0, removedCount: 0, filesDeleted: 0 } }
      const updated = { ...space, status: 'deleting', deletion: next, updatedAt: stamp() }
      await transaction.updateById('CoupleSpaceList', space._id, { deletion: next, updatedAt: updated.updatedAt }, { replaceObjectFields: ['deletion'] })
      return lifecycleResult(updated, caller._openid)
    })
  }

  async function continueSpacePurge(caller, input = {}) {
    const requestedOperationId = compact(input.operationId)
    if (!compact(caller.spaceId)) {
      const completed = caller.lastSpacePurge
      if (completed && completed.operationId === requestedOperationId) return { phase: 'complete', completed: true, operationId: requestedOperationId }
      fail('DELETION_OPERATION_STALE')
    }
    const { space } = await lifecycleContext(store, caller)
    const deletion = space.deletion
    requireDeletionOperation(input, deletion)
    if (!deletion || deletion.phase !== 'purging') fail('DELETION_NOT_PURGING')
    const progress = deletion.progress && typeof deletion.progress === 'object'
      ? deletion.progress
      : { collectionIndex: 0, removedCount: 0, filesDeleted: 0 }
    // v1 曾把 SpaceFileList 放在第 0 位。已有在途游标必须继续沿用旧顺序，
    // 否则同一个数字会指向另一集合并漏删数据。新流程显式写 orderVersion=2。
    const purgeCollections = progress.orderVersion === 2 ? PURGE_COLLECTIONS : PURGE_COLLECTIONS_V1
    const collectionIndex = Number.isSafeInteger(progress.collectionIndex) && progress.collectionIndex >= 0
      ? progress.collectionIndex
      : 0

    if (collectionIndex >= purgeCollections.length) {
      const finalSpace = await store.getById('CoupleSpaceList', caller.spaceId)
      const finalCandidates = await store.findMany('UserList', { spaceId: caller.spaceId })
      return store.runTransaction(async transaction => {
        const freshCaller = await transaction.getById('UserList', caller._id)
        if (!freshCaller || freshCaller._openid !== caller._openid) fail('UNAUTHORIZED')
        if (!compact(freshCaller.spaceId)) {
          const completed = freshCaller.lastSpacePurge
          if (completed && completed.operationId === requestedOperationId) return { phase: 'complete', completed: true, operationId: requestedOperationId }
          fail('DELETION_OPERATION_STALE')
        }
        const context = await lifecycleContext(transaction, freshCaller, finalCandidates, finalSpace && finalSpace.membershipEpoch)
        const currentDeletion = context.space.deletion
        if (!currentDeletion || currentDeletion.phase !== 'purging') fail('DELETION_NOT_PURGING')
        const currentIndex = currentDeletion.progress && currentDeletion.progress.collectionIndex
        if (!(currentIndex >= purgeCollections.length)) fail('DELETION_PURGE_INCOMPLETE')
        const at = stamp()
        for (const member of context.members) {
          await transaction.updateById('UserList', member._id, { ...spaceMemberResetPatch(at), lastSpacePurge: { operationId: requestedOperationId, completedAt: at } }, { replaceObjectFields: ['lastSpacePurge'] })
        }
        await transaction.removeById('CoupleSpaceList', context.space._id)
        return { phase: 'complete', completed: true, operationId: requestedOperationId }
      })
    }

    const collection = purgeCollections[collectionIndex]
    const documents = await store.findMany(collection, { spaceId: space._id })
    const batch = documents.slice(0, PURGE_BATCH_SIZE)
    const candidates = batch.map(document => ({
      fileId: compact(document && (document.fileId || document.imageFileId)),
      legacyTrusted: collection === 'SpaceFileList' && document && document.legacyTrusted === true,
    }))
    const fileIds = []
    for (const entry of candidates) {
      const { fileId, legacyTrusted } = entry
      if (!fileId || fileIds.includes(fileId)) continue
      if (collection !== 'SpaceFileList' && await store.findOne('SpaceFileList', { spaceId: space._id, fileId })) continue
      if (legacyTrusted) {
        if (fileId.startsWith('cloud://') && fileId.length <= 1024 && !/\s/.test(fileId)) fileIds.push(fileId)
        continue
      }
      try { if (validateSpaceImage(fileId, space._id) === fileId) fileIds.push(fileId) } catch (error) { /* 坏引用只删记录，不删文件 */ }
    }
    if (fileIds.length) {
      if (!deleteFiles) fail('FILE_DELETE_UNAVAILABLE')
      try {
        await deleteFiles(fileIds)
      } catch (error) {
        if (error && typeof error === 'object') error.diagnosticStage = 'DELETE_CLOUD_FILE'
        throw error
      }
    }
    for (const document of batch) await store.removeById(collection, document._id)

    const nextProgress = {
      orderVersion: progress.orderVersion === 2 ? 2 : 1,
      collectionIndex: batch.length < PURGE_BATCH_SIZE ? collectionIndex + 1 : collectionIndex,
      removedCount: (Number(progress.removedCount) || 0) + batch.length,
      filesDeleted: (Number(progress.filesDeleted) || 0) + fileIds.length,
    }
    const nextDeletion = { ...deletion, progress: nextProgress }
    const updated = { ...space, deletion: nextDeletion, updatedAt: stamp() }
    await store.updateById('CoupleSpaceList', space._id, { deletion: nextDeletion, updatedAt: updated.updatedAt }, { replaceObjectFields: ['deletion'] })
    return lifecycleResult(updated, caller._openid)
  }

  return {
    bootstrap,
    approveSpaceDeletion,
    cancelSpaceDeletion,
    continueSpacePurge,
    createSpace,
    getInvite,
    inviteDigest,
    joinSpace,
    membersOf,
    regenerateInvite,
    rejectSpaceDeletion,
    requestSpaceDeletion,
    restoreLegacyDeletingSpace,
    requireOwnSpace,
    resolveInvite,
    spaceOf,
    unpair,
    updateProfile,
    updateSpace,
    userView,
    spaceView,
    startSpacePurge,
  }
}

module.exports = {
  DEFAULT_FEATURES,
  PURGE_BATCH_SIZE,
  PURGE_COLLECTIONS,
  PURGE_COLLECTIONS_V1,
  createSpaceManager,
  inviteDigest,
  newInviteToken,
}
