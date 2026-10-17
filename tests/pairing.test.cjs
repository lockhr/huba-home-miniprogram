const test = require('node:test')
const assert = require('node:assert/strict')

const { MemoryStore, emptyWorld, isoAt, pairedSpace } = require('./helpers/memory-store.cjs')
const { createService } = require('../cloudfunctions/api/service.js')
const { PURGE_COLLECTIONS, PURGE_COLLECTIONS_V1 } = require('../cloudfunctions/api/space-manager.js')

const HOUR = 60 * 60 * 1000

// 用可推进的时钟控制邀请的 48 小时有效期。
function world(startedAt = Date.parse('2026-09-16T04:00:00.000Z'), seed = emptyWorld(), options = {}) {
  const store = new MemoryStore(seed)
  let clock = startedAt
  const service = createService(store, () => new Date(clock).toISOString(), async () => ({ reply: '', model: 'test' }), options)
  return {
    store,
    service,
    advanceTo: value => { clock = value },
    advanceBy: amount => { clock += amount },
    now: () => clock,
  }
}

async function createOwnSpace(target, openid, name = '我们的空间') {
  await target.service.execute('getBootstrap', {}, openid)
  await target.service.execute('updateProfile', { displayName: '阿禾', identityNoticeAccepted: true }, openid)
  return target.service.execute('createSpace', { name }, openid)
}

async function completeProfile(target, openid, displayName = `用户${openid}`) {
  await target.service.execute('getBootstrap', {}, openid)
  await target.service.execute('updateProfile', { displayName, avatarKey: 'cat', identityNoticeAccepted: true }, openid)
}

async function createPairedSpace(target) {
  const created = await createOwnSpace(target, 'a')
  await completeProfile(target, 'b', '小柚')
  await target.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'b')
  return created
}

function rejectQueriesInsideTransactions(store) {
  const run = store.runTransaction.bind(store)
  store.runTransaction = callback => run(transaction => callback(new Proxy(transaction, {
    get(target, property) {
      if (property === 'findOne' || property === 'findMany') {
        return async () => { throw new Error('transactions only support document ID reads') }
      }
      const value = target[property]
      return typeof value === 'function' ? value.bind(target) : value
    },
  })))
}

function rejectOutsideQueriesWhileTransactionRuns(store) {
  const run = store.runTransaction.bind(store)
  const findMany = store.findMany.bind(store)
  let insideTransaction = false
  store.findMany = async (...args) => {
    if (insideTransaction) throw new Error('query outside transaction while transaction runs')
    return findMany(...args)
  }
  store.runTransaction = callback => run(async transaction => {
    insideTransaction = true
    try { return await callback(transaction) }
    finally { insideTransaction = false }
  })
}

test('单人空间注销不在事务执行期间发起普通成员查询', async () => {
  const w = world()
  await createOwnSpace(w, 'a')
  rejectOutsideQueriesWhileTransactionRuns(w.store)
  const requested = await w.service.execute('requestSpaceDeletion', {}, 'a')
  assert.equal(requested.phase, 'cooldown')
  const started = await w.service.execute('startSpacePurge', { operationId: requested.operationId }, 'a')
  assert.equal(started.phase, 'purging')
  let progress = started
  for (let attempt = 0; attempt < 20 && progress.phase !== 'complete'; attempt += 1) {
    progress = await w.service.execute('continueSpacePurge', { operationId: requested.operationId }, 'a')
  }
  assert.equal(progress.phase, 'complete')
})

test('注销写入失败时标注写入阶段且事务不改变原空间', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  const run = w.store.runTransaction.bind(w.store)
  w.store.runTransaction = callback => run(transaction => callback(new Proxy(transaction, {
    get(target, property) {
      if (property === 'updateById') return async (name, id, patch) => {
        if (name === 'CoupleSpaceList' && patch.deletion) throw new Error('cloud write failed')
        return target.updateById(name, id, patch)
      }
      const value = target[property]
      return typeof value === 'function' ? value.bind(target) : value
    },
  })))
  await assert.rejects(
    () => w.service.execute('requestSpaceDeletion', {}, 'a'),
    error => error.diagnosticStage === 'WRITE_SPACE',
  )
  const space = await w.store.getById('CoupleSpaceList', created.spaceId)
  assert.equal(space.status, 'active')
  assert.equal(space.deletion, undefined)
})

test('曾撤销注销的单人空间可重新申请并开始清理', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  const space = w.store.data.CoupleSpaceList.find(item => item._id === created.spaceId)
  space.deletion = null
  const run = w.store.runTransaction.bind(w.store)
  w.store.runTransaction = callback => run(transaction => callback(new Proxy(transaction, {
    get(target, property) {
      if (property === 'updateById') return async (name, id, patch, options) => {
        if (name === 'CoupleSpaceList' && patch.deletion && !options?.replaceObjectFields?.includes('deletion')) {
          throw new Error("Cannot create field 'approvedBy' in element {deletion: null}")
        }
        return target.updateById(name, id, patch)
      }
      const value = target[property]
      return typeof value === 'function' ? value.bind(target) : value
    },
  })))

  const requested = await w.service.execute('requestSpaceDeletion', {}, 'a')
  assert.equal(requested.phase, 'cooldown')
  const started = await w.service.execute('startSpacePurge', { operationId: requested.operationId }, 'a')
  assert.equal(started.phase, 'purging')
})

test('配对与邀请更新不在事务执行期间发起普通成员查询', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  await completeProfile(w, 'b')
  rejectOutsideQueriesWhileTransactionRuns(w.store)
  await w.service.execute('regenerateInvite', {}, 'a')
  const activeInvite = w.store.data.PairInviteList.find(invite => invite.status === 'active')
  assert.ok(activeInvite)
  await assert.rejects(
    () => w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'b'),
    error => error.code === 'INVALID_INVITE',
  )
  const current = await w.service.execute('regenerateInvite', {}, 'a')
  await w.service.execute('joinSpace', { inviteToken: current.inviteToken }, 'b')
  await w.service.execute('unpair', {}, 'b')
})

test('单人空间注销不依赖事务内条件查询', async () => {
  const w = world()
  await createOwnSpace(w, 'a')
  rejectQueriesInsideTransactions(w.store)
  const requested = await w.service.execute('requestSpaceDeletion', {}, 'a')
  assert.equal(requested.phase, 'cooldown')
  const started = await w.service.execute('startSpacePurge', { operationId: requested.operationId }, 'a')
  assert.equal(started.phase, 'purging')
})

test('配对及解除配对不依赖事务内条件查询', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  await completeProfile(w, 'b')
  rejectQueriesInsideTransactions(w.store)
  await w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'b')
  await w.service.execute('unpair', {}, 'b')
  const renewed = await w.service.execute('regenerateInvite', {}, 'a')
  assert.ok(renewed.inviteToken)
})

test('同一个微信身份并发保存首次资料只创建一条用户记录', async () => {
  const w = world()

  await Promise.all([
    w.service.execute('updateProfile', { displayName: '新用户', identityNoticeAccepted: true }, 'new-user'),
    w.service.execute('updateProfile', { displayName: '新用户', identityNoticeAccepted: true }, 'new-user'),
  ])

  assert.equal(w.store.data.UserList.filter(user => user._openid === 'new-user').length, 1)
})

test('新用户必须确认当前微信身份说明，已有资料用户不被重复阻断', async () => {
  const w = world()

  await assert.rejects(
    () => w.service.execute('updateProfile', { displayName: '阿禾', avatarKey: 'cat' }, 'new-user'),
    error => error.code === 'IDENTITY_NOTICE_REQUIRED',
  )
  assert.equal(w.store.data.UserList.length, 0, '未确认时不能留下半注册账号')

  const saved = await w.service.execute('updateProfile', {
    displayName: '阿禾',
    avatarKey: 'cat',
    identityNoticeAccepted: true,
  }, 'new-user')
  assert.equal(saved.displayName, '阿禾')
  const user = w.store.data.UserList.find(item => item._openid === 'new-user')
  assert.equal(user.identityNoticeVersion, 1)
  assert.ok(user.identityNoticeAcceptedAt)

  await w.service.execute('updateProfile', { displayName: '新昵称', avatarKey: 'fox' }, 'new-user')
  assert.equal(w.store.data.UserList.find(item => item._openid === 'new-user').displayName, '新昵称')
})

test('新体系账号即使被旧客户端提前写入昵称，没有确认记录仍不能跳过首次说明', async () => {
  const data = emptyWorld()
  data.UserList.push({
    _id: 'wx-modern',
    _openid: 'modern-user',
    displayName: '已经有昵称',
    avatarKey: 'cat',
    spaceId: '',
    memberStatus: 'active',
    createdAt: isoAt(),
    updatedAt: isoAt(),
  })
  const w = world(Date.parse('2026-09-20T04:00:00.000Z'), data)

  const before = await w.service.execute('getBootstrap', {}, 'modern-user')
  assert.equal(before.user.profileComplete, true)
  assert.equal(before.user.identityNoticeRequired, true)
  assert.equal(before.user.onboardingComplete, false)
  await assert.rejects(
    () => w.service.execute('updateProfile', { displayName: '已经有昵称', avatarKey: 'cat' }, 'modern-user'),
    error => error.code === 'IDENTITY_NOTICE_REQUIRED',
  )
  await assert.rejects(
    () => w.service.execute('createSpace', { name: '不应创建的空间' }, 'modern-user'),
    error => error.code === 'IDENTITY_NOTICE_REQUIRED',
  )

  await w.service.execute('updateProfile', {
    displayName: '已经有昵称',
    avatarKey: 'cat',
    identityNoticeAccepted: true,
  }, 'modern-user')
  const after = await w.service.execute('getBootstrap', {}, 'modern-user')
  assert.equal(after.user.identityNoticeRequired, false)
  assert.equal(after.user.onboardingComplete, true)
})

test('未完成身份确认的新体系账号不能绕过页面直接加入邀请', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  w.store.data.UserList.push({
    _id: 'wx-modern-joiner', _openid: 'modern-joiner', displayName: '旧客户端昵称',
    avatarKey: 'cat', spaceId: '', memberStatus: 'active', createdAt: isoAt(), updatedAt: isoAt(),
  })

  await assert.rejects(
    () => w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'modern-joiner'),
    error => error.code === 'IDENTITY_NOTICE_REQUIRED',
  )
  assert.equal(w.store.data.PairInviteList[0].status, 'active', '拦截时不能消耗邀请')
})

test('迁移老账号有昵称但没有 createdAt 时继续视为已注册，不重复阻断', async () => {
  const data = emptyWorld()
  data.UserList.push({
    _id: 'legacy-user',
    _openid: 'legacy-user',
    displayName: '老用户',
    avatarKey: 'fox',
    spaceId: '',
    memberStatus: 'active',
  })
  const w = world(Date.parse('2026-09-20T04:00:00.000Z'), data)

  const bootstrap = await w.service.execute('getBootstrap', {}, 'legacy-user')
  assert.equal(bootstrap.user.identityNoticeRequired, false)
  assert.equal(bootstrap.user.onboardingComplete, true)
  await w.service.execute('updateProfile', { displayName: '老用户新昵称', avatarKey: 'fox' }, 'legacy-user')
})

test('创建空间会同时写入空间、个人 spaceId 和一条一次性邀请', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')

  assert.ok(created.spaceId)
  assert.ok(created.inviteToken)
  assert.equal(w.store.data.CoupleSpaceList.length, 1)
  assert.equal(w.store.data.CoupleSpaceList[0].status, 'active')
  assert.equal(w.store.data.CoupleSpaceList[0].name, '我们的空间')
  assert.equal(w.store.data.CoupleSpaceList[0].createdBy, 'a')

  const me = w.store.data.UserList.find(user => user._openid === 'a')
  assert.equal(me.spaceId, created.spaceId)
  assert.equal(me.memberStatus, 'active')

  assert.equal(w.store.data.PairInviteList.length, 1)
  const invite = w.store.data.PairInviteList[0]
  assert.equal(invite.status, 'active')
  assert.equal(invite.inviterOpenid, 'a')
  assert.equal(invite.usedBy, '')
  assert.match(invite.tokenDigest, /^[0-9a-f]{64}$/, '数据库只保存摘要')
  assert.equal(
    JSON.stringify(invite).includes(created.inviteToken),
    false,
    '明文邀请标识不能落库',
  )
  assert.equal(Date.parse(invite.expiresAt) - w.now(), 48 * HOUR)
})

test('邀请标识至少 32 字节随机，两次生成不会重复', async () => {
  const w = world()
  const first = await createOwnSpace(w, 'a')
  const second = await w.service.execute('regenerateInvite', {}, 'a')

  assert.notEqual(first.inviteToken, second.inviteToken)
  assert.ok(Buffer.from(first.inviteToken, 'base64url').length >= 32)
  assert.ok(Buffer.from(second.inviteToken, 'base64url').length >= 32)
})

test('已经在空间里的人不能再创建第二个空间', async () => {
  const w = world()
  await createOwnSpace(w, 'a')
  await assert.rejects(() => w.service.execute('createSpace', { name: '另一个空间' }, 'a'), error => error.code === 'ALREADY_PAIRED')
  assert.equal(w.store.data.CoupleSpaceList.length, 1)
})

test('空间名和纪念日都在服务端校验', async () => {
  const w = world()
  await w.service.execute('updateProfile', { displayName: '阿禾', avatarKey: 'cat', identityNoticeAccepted: true }, 'a')

  await assert.rejects(() => w.service.execute('createSpace', { name: '   ' }, 'a'), error => error.code === 'INVALID_SPACE_NAME')
  await assert.rejects(
    () => w.service.execute('createSpace', { name: '一'.repeat(21) }, 'a'),
    error => error.code === 'INVALID_SPACE_NAME',
  )
  await assert.rejects(
    () => w.service.execute('createSpace', { name: '空间', anniversaryDate: '2026/05/20' }, 'a'),
    error => error.code === 'INVALID_ANNIVERSARY',
  )
  await assert.rejects(
    () => w.service.execute('createSpace', { name: '空间', anniversaryDate: '2026-12-31' }, 'a'),
    error => error.code === 'INVALID_ANNIVERSARY',
  )

  // 纪念日可以留空，也可以只填一次
  const created = await w.service.execute('createSpace', { name: '空间' }, 'a')
  assert.ok(created.spaceId)
  assert.equal(w.store.data.CoupleSpaceList[0].anniversaryDate, '')
})

test('getInvite 只判断能不能用，valid 时只返回空间名和邀请人昵称', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  w.store.data.HouseRuleList.push({ _id: 'rule-1', _openid: 'a', spaceId: created.spaceId, content: '不该泄露的家规', date: isoAt() })

  const preview = await w.service.execute('getInvite', { inviteToken: created.inviteToken }, 'b')

  assert.equal(preview.status, 'valid')
  assert.equal(preview.spaceName, '我们的空间')
  assert.equal(preview.inviterName, '阿禾')
  assert.equal(JSON.stringify(preview).includes('不该泄露的家规'), false)
  assert.equal(JSON.stringify(preview).includes(created.spaceId), false, '不能把 spaceId 交给还没加入的人')
})

test('getInvite 对每种异常给出确定的 status', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')

  assert.equal((await w.service.execute('getInvite', {}, 'b')).status, 'missing')
  assert.equal((await w.service.execute('getInvite', { inviteToken: 'not-a-real-token' }, 'b')).status, 'missing')

  // 过期
  w.advanceBy(49 * HOUR)
  assert.equal((await w.service.execute('getInvite', { inviteToken: created.inviteToken }, 'b')).status, 'expired')

  // 重新生成一条可用邀请
  w.advanceBy(-49 * HOUR)
  const fresh = await w.service.execute('regenerateInvite', {}, 'a')
  const afterRegenerate = await w.service.execute('getInvite', { inviteToken: created.inviteToken }, 'b')
  assert.equal(afterRegenerate.status, 'missing', '重新生成后旧邀请立即失效')

  // 已使用
  await completeProfile(w, 'b', '小柚')
  await w.service.execute('joinSpace', { inviteToken: fresh.inviteToken }, 'b')
  assert.equal((await w.service.execute('getInvite', { inviteToken: fresh.inviteToken }, 'b')).status, 'used')

  // 已配对时不再生成必然无效的邀请卡片。
  await assert.rejects(
    () => w.service.execute('regenerateInvite', {}, 'a'),
    error => error.code === 'SPACE_FULL',
  )

  // 调用者已经在别的空间里
  const other = await createOwnSpace(w, 'd', '另一个空间')
  assert.equal((await w.service.execute('getInvite', { inviteToken: other.inviteToken }, 'b')).status, 'occupied')
})

test('被冻结的空间不再接受加入，并且不对外暴露自己处于冻结状态', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  w.store.data.CoupleSpaceList[0].status = 'frozen'

  const preview = await w.service.execute('getInvite', { inviteToken: created.inviteToken }, 'b')
  assert.equal(preview.status, 'missing')
  assert.equal(JSON.stringify(preview).includes('frozen'), false)

  await completeProfile(w, 'b', '小柚')
  await assert.rejects(
    () => w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'b'),
    error => error.code === 'SPACE_FROZEN',
  )
})

test('joinSpace 在一次事务里把两个人放进同一个空间', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  await completeProfile(w, 'b', '小柚')

  const joined = await w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'b')
  assert.equal(joined.spaceId, created.spaceId)

  const a = w.store.data.UserList.find(user => user._openid === 'a')
  const b = w.store.data.UserList.find(user => user._openid === 'b')
  assert.equal(a.spaceId, created.spaceId)
  assert.equal(b.spaceId, created.spaceId)
  assert.equal(w.store.data.PairInviteList[0].status, 'used')
  assert.equal(w.store.data.PairInviteList[0].usedBy, 'b')

  const bootstrap = await w.service.execute('getBootstrap', {}, 'b')
  assert.equal(bootstrap.state, 'ready')
  assert.equal(bootstrap.partner.openid, 'a')
})

test('未完成资料不能加入，补好昵称后同一条邀请仍然有效', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  w.store.data.UserList.push({
    _id: 'wx-b', _openid: 'b', displayName: '', avatarKey: 'cat', spaceId: '',
    memberStatus: 'active', createdAt: isoAt(), identityNoticeAcceptedAt: isoAt(), updatedAt: isoAt(),
  })

  await assert.rejects(
    () => w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'b'),
    error => error.code === 'PROFILE_REQUIRED',
  )
  assert.equal(w.store.data.PairInviteList[0].status, 'active', '资料不完整不能消耗邀请')

  await w.service.execute('updateProfile', { displayName: '小柚', avatarKey: 'rabbit', identityNoticeAccepted: true }, 'b')
  const joined = await w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'b')
  assert.equal(joined.spaceId, created.spaceId)
  assert.equal(w.store.data.PairInviteList[0].status, 'used')
})

test('同一条邀请第二次使用会被拒绝', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  await completeProfile(w, 'b', '小柚')
  await w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'b')
  await completeProfile(w, 'c', '小芽')

  await assert.rejects(
    () => w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'c'),
    error => error.code === 'INVITE_USED',
  )
  assert.equal(w.store.data.UserList.find(user => user._openid === 'c').spaceId, '')
})

test('过期的邀请不能加入', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  await completeProfile(w, 'b', '小柚')
  w.advanceBy(49 * HOUR)

  await assert.rejects(
    () => w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'b'),
    error => error.code === 'INVITE_EXPIRED',
  )
})

test('空间满员后第三个人进不来', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  await completeProfile(w, 'b', '小柚')
  await w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'b')
  // 兼容旧版在满员空间留下的未使用邀请；新版不会再新生成这种无效邀请。
  const legacyToken = 'legacy-full-space-token'
  w.store.data.PairInviteList.push({
    _id: 'legacy-full-invite', spaceId: created.spaceId, inviterOpenid: 'a',
    tokenDigest: require('../cloudfunctions/api/space-manager.js').inviteDigest(legacyToken),
    status: 'active', expiresAt: new Date(w.now() + HOUR).toISOString(), usedBy: '', usedAt: null,
  })
  await completeProfile(w, 'c', '小芽')

  await assert.rejects(
    () => w.service.execute('joinSpace', { inviteToken: legacyToken }, 'c'),
    error => error.code === 'SPACE_FULL',
  )
})

test('任务同一次请求重试或并发只创建一条，不按标题粗暴去重', async () => {
  const w = world(Date.parse('2026-09-16T04:00:00.000Z'), pairedSpace())
  const input = { list: 'MissionList', title: '一起散步', desc: '', credit: 5, requestId: 'req-same-001' }
  const [first, repeated] = await Promise.all([
    w.service.execute('createElement', input, 'a'),
    w.service.execute('createElement', input, 'a'),
  ])
  assert.equal(first._id, repeated._id)
  assert.equal(w.store.data.MissionList.length, 1)
  const fresh = await w.service.execute('createElement', { ...input, requestId: 'req-new-002' }, 'a')
  assert.notEqual(fresh._id, first._id)
  assert.equal(w.store.data.MissionList.length, 2)
})

test('重复请求标识不能改内容，同标识在另一账号或商品集合互不冲突', async () => {
  const w = world(Date.parse('2026-09-16T04:00:00.000Z'), pairedSpace())
  const input = { list: 'MissionList', title: '一起散步', desc: '', credit: 5, requestId: 'req-shared-001' }
  await w.service.execute('createElement', input, 'a')
  await assert.rejects(
    () => w.service.execute('createElement', { ...input, title: '换个任务' }, 'a'),
    error => error.code === 'REQUEST_REUSED',
  )
  await w.service.execute('createElement', input, 'b')
  await w.service.execute('createElement', { ...input, list: 'MarketList' }, 'a')
  assert.equal(w.store.data.MissionList.length, 2)
  assert.equal(w.store.data.MarketList.length, 1)
})

test('旧版满员邀请不会在一方离开后重新变为有效', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  await completeProfile(w, 'b', '小柚')
  await w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'b')
  const oldToken = 'legacy-active-after-full'
  w.store.data.PairInviteList.push({
    _id: 'legacy-active-after-full', spaceId: created.spaceId, inviterOpenid: 'a',
    tokenDigest: require('../cloudfunctions/api/space-manager.js').inviteDigest(oldToken),
    status: 'active', expiresAt: new Date(w.now() + HOUR).toISOString(), usedBy: '', usedAt: null,
  })
  assert.equal((await w.service.execute('getInvite', { inviteToken: oldToken }, 'c')).status, 'full')
  await w.service.execute('unpair', {}, 'b')
  assert.equal((await w.service.execute('getInvite', { inviteToken: oldToken }, 'c')).status, 'missing')
})

test('重生邀请前一刻离开空间的账号不能再为原空间发邀请', async () => {
  class LeaveBeforeInviteStore extends MemoryStore {
    constructor(seed) { super(seed); this.transactions = 0 }
    async runTransaction(callback) {
      this.transactions += 1
      if (this.transactions === 2) {
        const caller = this.data.UserList.find(user => user._openid === 'a')
        caller.spaceId = ''
        caller.memberStatus = 'left'
      }
      return super.runTransaction(callback)
    }
  }
  const store = new LeaveBeforeInviteStore(pairedSpace())
  const service = createService(store, () => isoAt(), async () => ({ reply: '', model: 'test' }))
  const before = store.data.PairInviteList.length
  await assert.rejects(
    () => service.execute('regenerateInvite', {}, 'a'),
    error => error.code === 'NO_SPACE' || error.code === 'UNAUTHORIZED',
  )
  assert.equal(store.data.PairInviteList.length, before)
})

test('已经属于别的空间的人不能用新邀请再加入', async () => {
  const w = world()
  await createOwnSpace(w, 'a')
  const other = await createOwnSpace(w, 'd', '另一个空间')

  await assert.rejects(
    () => w.service.execute('joinSpace', { inviteToken: other.inviteToken }, 'a'),
    error => error.code === 'ALREADY_PAIRED',
  )
  assert.equal(w.store.data.CoupleSpaceList.length, 2)
})

test('两个人同时用同一条邀请，只有一个人能成功', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  await completeProfile(w, 'b', '小柚')
  await completeProfile(w, 'c', '小芽')

  const results = await Promise.allSettled([
    w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'b'),
    w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'c'),
  ])

  const joined = results.filter(result => result.status === 'fulfilled')
  const rejected = results.filter(result => result.status === 'rejected')
  assert.equal(joined.length, 1, '并发配对必须只成功一次')
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0].reason.code, 'INVITE_USED')

  const members = w.store.data.UserList.filter(user => user.spaceId === created.spaceId)
  assert.equal(members.length, 2)
})

test('unpair 只让自己离开，空间和对方的内容都保留', async () => {
  const w = world()
  const created = await createOwnSpace(w, 'a')
  await completeProfile(w, 'b', '小柚')
  await w.service.execute('joinSpace', { inviteToken: created.inviteToken }, 'b')
  await w.service.execute('createWish', { title: '一起去看海' }, 'b')
  const caller = w.store.data.UserList.find(user => user._openid === 'a')
  Object.assign(caller, { credit: 88, mood: 'happy', steps: 6789, stepsDate: '2026-09-20', reminderCredits: 2, reminderReady: true })

  const left = await w.service.execute('unpair', {}, 'a')
  assert.equal(left.removed, true)

  const a = w.store.data.UserList.find(user => user._openid === 'a')
  const b = w.store.data.UserList.find(user => user._openid === 'b')
  assert.equal(a.spaceId, '')
  assert.equal(a.memberStatus, 'left')
  assert.equal(a.credit, 0, '积分属于原空间，不能带到下一个空间')
  assert.equal(a.mood, 'calm')
  assert.equal(a.steps, 0)
  assert.equal(a.reminderCredits, 0)
  assert.equal(a.displayName, '阿禾', '昵称属于微信资料，应保留')
  assert.equal(b.spaceId, created.spaceId)
  assert.equal(b.memberStatus, 'active')
  assert.equal(w.store.data.CoupleSpaceList.length, 1)
  assert.equal(w.store.data.WishList.length, 1)

  const bootstrap = await w.service.execute('getBootstrap', {}, 'a')
  assert.equal(bootstrap.state, 'unpaired')
  assert.equal(bootstrap.partner, null)
  await assert.rejects(() => w.service.execute('getRecords', {}, 'a'), error => error.code === 'NO_SPACE')
})

test('邀请解析后空间开始删除，事务内必须重新检查并拒绝加入', async () => {
  const data = pairedSpace()
  data.UserList[1] = {
    ...data.UserList[1], spaceId: '', memberStatus: 'active', createdAt: isoAt(), identityNoticeAcceptedAt: isoAt(),
  }
  data.PairInviteList.push({
    _id: 'invite-race', spaceId: 'space-1', inviterOpenid: 'a',
    tokenDigest: require('../cloudfunctions/api/space-manager.js').inviteDigest('race-token'),
    status: 'active', expiresAt: new Date(Date.parse(isoAt()) + HOUR).toISOString(), usedBy: '', usedAt: null,
  })

  class DeleteBeforeJoinTransactionStore extends MemoryStore {
    constructor(seed) { super(seed); this.armDeletion = false }
    async runTransaction(callback) {
      if (this.armDeletion) {
        this.data.CoupleSpaceList[0].status = 'deleting'
        this.armDeletion = false
      }
      return super.runTransaction(callback)
    }
  }

  const store = new DeleteBeforeJoinTransactionStore(data)
  const service = createService(store, () => isoAt(), async () => ({ reply: '', model: 'test' }))
  store.armDeletion = true

  await assert.rejects(
    () => service.execute('joinSpace', { inviteToken: 'race-token' }, 'b'),
    error => error.code === 'SPACE_DELETING',
  )
  assert.equal(store.data.UserList.find(user => user._openid === 'b').spaceId, '')
  assert.equal(store.data.PairInviteList[0].status, 'active')
})

test('空间只剩最后一名成员时不能解除关系并遗弃空间', async () => {
  const data = pairedSpace()
  data.UserList[1] = { ...data.UserList[1], spaceId: '', memberStatus: 'left' }
  const w = world(Date.parse('2026-09-16T04:00:00.000Z'), data)

  await assert.rejects(
    () => w.service.execute('unpair', {}, 'a'),
    error => error.code === 'LAST_MEMBER_MUST_DELETE_SPACE',
  )
  assert.equal(w.store.data.UserList[0].spaceId, 'space-1')
  assert.equal(w.store.data.CoupleSpaceList.length, 1)
})

test('双人空间申请注销时继续可用，必须由另一方同意才能开始清理', async () => {
  const w = world()
  await createPairedSpace(w)

  const result = await w.service.execute('requestSpaceDeletion', {}, 'a')
  assert.equal(result.phase, 'awaiting_partner')
  assert.equal(w.store.data.CoupleSpaceList[0].status, 'active')

  await w.service.execute('createHouseRule', { content: '申请期间仍能正常使用' }, 'a')
  await assert.rejects(
    () => w.service.execute('approveSpaceDeletion', { operationId: result.operationId }, 'a'),
    error => error.code === 'DELETION_ALREADY_APPROVED',
  )

  const approved = await w.service.execute('approveSpaceDeletion', { operationId: result.operationId }, 'b')
  assert.equal(approved.phase, 'cooldown')
  assert.equal(w.store.data.CoupleSpaceList[0].status, 'deleting')
  assert.equal(approved.canFinalize, true)

  await assert.rejects(
    () => w.service.execute('createHouseRule', { content: '写不进去了' }, 'a'),
    error => error.code === 'SPACE_DELETING',
  )
})

test('注销申请可以拒绝，冷静期内任一成员也可以撤销', async () => {
  const w = world()
  await createPairedSpace(w)

  const firstRequest = await w.service.execute('requestSpaceDeletion', {}, 'a')
  const rejected = await w.service.execute('rejectSpaceDeletion', { operationId: firstRequest.operationId }, 'b')
  assert.equal(rejected.phase, 'none')
  assert.equal(w.store.data.CoupleSpaceList[0].status, 'active')
  assert.equal(w.store.data.CoupleSpaceList[0].deletion, null)
  assert.deepEqual(await w.service.execute('rejectSpaceDeletion', { operationId: firstRequest.operationId }, 'b'), rejected, '重复拒绝应幂等')

  const secondRequest = await w.service.execute('requestSpaceDeletion', {}, 'a')
  await w.service.execute('approveSpaceDeletion', { operationId: secondRequest.operationId }, 'b')
  const cancelled = await w.service.execute('cancelSpaceDeletion', { operationId: secondRequest.operationId }, 'a')
  assert.equal(cancelled.phase, 'none')
  assert.equal(w.store.data.CoupleSpaceList[0].status, 'active')
  assert.equal(w.store.data.CoupleSpaceList[0].deletion, null)
  assert.deepEqual(await w.service.execute('cancelSpaceDeletion', { operationId: secondRequest.operationId }, 'a'), cancelled, '重复撤销应幂等')

  const thirdRequest = await w.service.execute('requestSpaceDeletion', {}, 'a')
  await w.service.execute('approveSpaceDeletion', { operationId: thirdRequest.operationId }, 'b')
  await w.service.execute('cancelSpaceDeletion', { operationId: thirdRequest.operationId }, 'b')
  assert.equal(w.store.data.CoupleSpaceList[0].status, 'active')
})

test('单人空间确认申请后无需等待即可开始最终清理', async () => {
  const w = world()
  await createOwnSpace(w, 'a')

  const requested = await w.service.execute('requestSpaceDeletion', {}, 'a')
  assert.equal(requested.phase, 'cooldown')
  assert.equal(w.store.data.CoupleSpaceList[0].status, 'deleting')

  const purge = await w.service.execute('startSpacePurge', { operationId: requested.operationId }, 'a')
  assert.equal(purge.phase, 'purging')
})

test('撤销注销会显式整体替换 deletion 字段，兼容云数据库对象更新语义', async () => {
  const w = world()
  await createPairedSpace(w)
  const requested = await w.service.execute('requestSpaceDeletion', {}, 'a')
  const run = w.store.runTransaction.bind(w.store)
  w.store.runTransaction = callback => run(transaction => callback(new Proxy(transaction, {
    get(target, property) {
      if (property === 'updateById') return async (name, id, patch, options) => {
        if (name === 'CoupleSpaceList' && patch.deletion === null
          && !options?.replaceObjectFields?.includes('deletion')) {
          throw new Error('object fields must be replaced explicitly')
        }
        return target.updateById(name, id, patch)
      }
      const value = target[property]
      return typeof value === 'function' ? value.bind(target) : value
    },
  })))

  const result = await w.service.execute('cancelSpaceDeletion', { operationId: requested.operationId }, 'a')

  assert.equal(result.phase, 'none')
  assert.equal(w.store.data.CoupleSpaceList[0].deletion, null)
  assert.equal(w.store.data.CoupleSpaceList[0].status, 'active')
})

test('注销待确认时解除配对也会显式清空 deletion 对象', async () => {
  const w = world()
  await createPairedSpace(w)
  await w.service.execute('requestSpaceDeletion', {}, 'a')
  const run = w.store.runTransaction.bind(w.store)
  w.store.runTransaction = callback => run(transaction => callback(new Proxy(transaction, {
    get(target, property) {
      if (property === 'updateById') return async (name, id, patch, options) => {
        if (name === 'CoupleSpaceList' && patch.deletion === null
          && !options?.replaceObjectFields?.includes('deletion')) {
          throw new Error('object fields must be replaced explicitly')
        }
        return target.updateById(name, id, patch)
      }
      const value = target[property]
      return typeof value === 'function' ? value.bind(target) : value
    },
  })))

  const result = await w.service.execute('unpair', {}, 'b')

  assert.equal(result.removed, true)
  assert.equal(w.store.data.CoupleSpaceList[0].deletion, null)
})

test('单人空间清理完成后仍是已注册账号，另行注销个人账号才回到新用户', async () => {
  const w = world()
  await createOwnSpace(w, 'a')
  const requested = await w.service.execute('requestSpaceDeletion', {}, 'a')
  await w.service.execute('startSpacePurge', { operationId: requested.operationId }, 'a')

  let result
  for (let attempt = 0; attempt < PURGE_COLLECTIONS.length + 2; attempt += 1) {
    result = await w.service.execute('continueSpacePurge', { operationId: requested.operationId }, 'a')
    if (result.phase === 'complete') break
  }
  assert.equal(result.phase, 'complete')
  assert.equal(w.store.data.CoupleSpaceList.length, 0)

  const afterSpace = await w.service.execute('getBootstrap', {}, 'a')
  assert.equal(afterSpace.state, 'unpaired')
  assert.equal(afterSpace.user.registered, true)
  assert.equal(afterSpace.user.onboardingComplete, true)

  assert.deepEqual(await w.service.execute('deleteAccount', {}, 'a'), { deleted: true })
  const afterAccount = await w.service.execute('getBootstrap', {}, 'a')
  assert.equal(afterAccount.state, 'unpaired')
  assert.equal(afterAccount.user.registered, false)
  assert.equal(afterAccount.user.onboardingComplete, false)
})

test('双人空间只有另一方同意后才能立即清理，旧冷静期申请也不再等待', async () => {
  const w = world()
  await createPairedSpace(w)
  const requested = await w.service.execute('requestSpaceDeletion', {}, 'a')
  await assert.rejects(
    () => w.service.execute('startSpacePurge', { operationId: requested.operationId }, 'a'),
    error => error.code === 'DELETION_NOT_READY',
  )
  const approved = await w.service.execute('approveSpaceDeletion', { operationId: requested.operationId }, 'b')
  assert.equal(approved.canFinalize, true)
  const purge = await w.service.execute('startSpacePurge', { operationId: requested.operationId }, 'b')
  assert.equal(purge.phase, 'purging')
})

test('服务端即使遇到旧的待清理状态，也不能在成员未全部同意时删除', async () => {
  const data = pairedSpace()
  data.CoupleSpaceList[0].status = 'deleting'
  data.CoupleSpaceList[0].deletion = {
    operationId: 'incomplete-approval', requestedBy: 'a', approvedBy: ['a'],
    phase: 'cooldown', cooldownEndsAt: isoAt(),
  }
  const w = world(Date.parse('2026-09-17T04:00:00.000Z'), data)
  await assert.rejects(
    () => w.service.execute('startSpacePurge', { operationId: 'incomplete-approval' }, 'a'),
    error => error.code === 'DELETION_NOT_READY',
  )
  assert.equal(w.store.data.CoupleSpaceList[0].status, 'deleting')
})

test('旧版 deleting 空间可以撤销恢复，不删除任何业务数据', async () => {
  const data = pairedSpace()
  data.CoupleSpaceList[0].status = 'deleting'
  data.WishList.push({ _id: 'wish-1', _openid: 'a', spaceId: 'space-1', content: '要保留的愿望' })
  const w = world(Date.parse('2026-09-16T04:00:00.000Z'), data)

  const before = JSON.stringify(w.store.data.WishList)
  const restored = await w.service.execute('restoreLegacyDeletingSpace', {}, 'a')

  assert.equal(restored.phase, 'none')
  assert.equal(w.store.data.CoupleSpaceList[0].status, 'active')
  assert.equal(JSON.stringify(w.store.data.WishList), before)
  assert.deepEqual(await w.service.execute('restoreLegacyDeletingSpace', {}, 'a'), { phase: 'none' })
})

test('另一方重复同意注销时返回当前冷静期，不报错', async () => {
  const w = world()
  await createPairedSpace(w)
  const requested = await w.service.execute('requestSpaceDeletion', {}, 'a')
  const first = await w.service.execute('approveSpaceDeletion', { operationId: requested.operationId }, 'b')
  const retry = await w.service.execute('approveSpaceDeletion', { operationId: requested.operationId }, 'b')
  assert.equal(retry.phase, 'cooldown')
  assert.equal(retry.cooldownEndsAt, first.cooldownEndsAt)
  await assert.rejects(
    () => w.service.execute('approveSpaceDeletion', { operationId: requested.operationId }, 'a'),
    error => error.code === 'DELETION_ALREADY_APPROVED',
  )
})

test('上一轮注销的陈旧重试不能影响新一轮申请', async () => {
  const w = world()
  await createPairedSpace(w)
  const first = await w.service.execute('requestSpaceDeletion', {}, 'a')
  await w.service.execute('rejectSpaceDeletion', { operationId: first.operationId }, 'b')
  const second = await w.service.execute('requestSpaceDeletion', {}, 'a')

  const oldRetry = await w.service.execute('rejectSpaceDeletion', { operationId: first.operationId }, 'b')
  assert.equal(oldRetry.operationId, first.operationId)
  assert.equal(w.store.data.CoupleSpaceList[0].deletion.operationId, second.operationId)
  assert.equal(w.store.data.CoupleSpaceList[0].deletion.phase, 'awaiting_partner')
  await assert.rejects(
    () => w.service.execute('approveSpaceDeletion', { operationId: 'unknown-old-operation' }, 'b'),
    error => error.code === 'DELETION_OPERATION_STALE',
  )
})

test('bootstrap 只返回当前成员可见的注销视图，不泄露双方 openid', async () => {
  const w = world()
  await createPairedSpace(w)
  await w.service.execute('requestSpaceDeletion', {}, 'a')

  const requester = await w.service.execute('getBootstrap', {}, 'a')
  const partner = await w.service.execute('getBootstrap', {}, 'b')
  assert.equal(requester.space.deletion.phase, 'awaiting_partner')
  assert.equal(requester.space.deletion.isRequester, true)
  assert.equal(requester.space.deletion.canApprove, false)
  assert.equal(partner.space.deletion.isRequester, false)
  assert.equal(partner.space.deletion.canApprove, true)
  assert.doesNotMatch(JSON.stringify(requester.space.deletion), /"a"|"b"/)
})

test('旧版结构化注销状态自动补操作号且保留清理进度', async () => {
  const data = pairedSpace()
  data.CoupleSpaceList[0].status = 'deleting'
  data.CoupleSpaceList[0].deletion = { requestedBy: 'a', approvedBy: ['a', 'b'], phase: 'purging', cooldownEndsAt: isoAt(), progress: { collectionIndex: 3, removedCount: 12, filesDeleted: 2 } }
  const w = world(Date.parse('2026-09-16T04:00:00.000Z'), data)
  const bootstrap = await w.service.execute('getBootstrap', {}, 'a')
  assert.match(bootstrap.space.deletion.operationId, /^[a-f0-9]{32}$/)
  assert.deepEqual(bootstrap.space.deletion.progress, { collectionIndex: 3, removedCount: 12, filesDeleted: 2 })
  const continued = await w.service.execute('continueSpacePurge', { operationId: bootstrap.space.deletion.operationId }, 'a')
  assert.equal(continued.phase, 'purging')
  assert.equal(w.store.data.CoupleSpaceList[0].status, 'deleting')
})

test('旧版清理游标继续使用旧集合顺序，不会漏掉任务数据', async () => {
  const data = pairedSpace()
  data.MissionList.push({ _id: 'legacy-mission', _openid: 'a', spaceId: 'space-1', title: '必须清掉' })
  data.CoupleSpaceList[0].status = 'deleting'
  data.CoupleSpaceList[0].deletion = {
    requestedBy: 'a', approvedBy: ['a', 'b'], phase: 'purging', cooldownEndsAt: isoAt(),
    progress: { collectionIndex: 1, removedCount: 0, filesDeleted: 0 },
  }
  const w = world(Date.parse('2026-09-16T04:00:00.000Z'), data)
  const bootstrap = await w.service.execute('getBootstrap', {}, 'a')
  let result = { phase: 'purging' }
  for (let attempt = 0; attempt < 20 && result.phase !== 'complete'; attempt += 1) {
    result = await w.service.execute('continueSpacePurge', { operationId: bootstrap.space.deletion.operationId }, 'a')
  }
  assert.equal(result.phase, 'complete')
  assert.equal(w.store.data.MissionList.length, 0)
})

test('旧版清理顺序的每个数字游标仍指向原集合', async t => {
  for (let index = 0; index < PURGE_COLLECTIONS_V1.length; index += 1) {
    await t.test(`${index} -> ${PURGE_COLLECTIONS_V1[index]}`, async () => {
      const collection = PURGE_COLLECTIONS_V1[index]
      const data = pairedSpace()
      data[collection] = [{ _id: `row-${index}`, spaceId: 'space-1' }]
      data.CoupleSpaceList[0].status = 'deleting'
      data.CoupleSpaceList[0].deletion = {
        operationId: `legacy-index-${index}`, requestedBy: 'a', approvedBy: ['a', 'b'], phase: 'purging', cooldownEndsAt: isoAt(),
        progress: { collectionIndex: index, removedCount: 0, filesDeleted: 0 },
      }
      const w = world(Date.parse('2026-09-16T04:00:00.000Z'), data)
      await w.service.execute('continueSpacePurge', { operationId: `legacy-index-${index}` }, 'a')
      assert.equal(w.store.data[collection].length, 0)
    })
  }
})

test('解除配对与同意注销并发后不会产生 deletion 为空的 deleting 假状态', async () => {
  const w = world()
  await createPairedSpace(w)
  const requested = await w.service.execute('requestSpaceDeletion', {}, 'a')
  await Promise.allSettled([
    w.service.execute('unpair', {}, 'a'),
    w.service.execute('approveSpaceDeletion', { operationId: requested.operationId }, 'b'),
  ])
  const space = w.store.data.CoupleSpaceList[0]
  assert.equal(space.status === 'deleting' && !space.deletion, false)
})

test('最终清理按小批次可重复推进，最后才解绑成员并删除空间', async () => {
  const data = pairedSpace()
  for (let index = 0; index < 25; index += 1) {
    data.MemoryPostList.push({
      _id: `post-${index}`,
      _openid: 'a',
      spaceId: 'space-1',
      content: `记录${index}`,
      imageFileId: index < 2 ? `cloud://env/couples/space-1/records/${index}.jpg` : '',
    })
  }
  data.SpaceFileList = [0, 1].map(index => ({
    _id: `file-${index}`, spaceId: 'space-1', fileId: `cloud://env/couples/space-1/records/${index}.jpg`,
  }))
  data.WishList.push({ _id: 'wish-1', _openid: 'a', spaceId: 'space-1', content: '愿望' })
  data.ScheduleList = [{ _id: 'schedule-1', spaceId: 'space-1', days: {} }]
  data.PairInviteList = [{ _id: 'invite-1', spaceId: 'space-1', status: 'used' }]
  data.CoupleSpaceList.push({ _id: 'space-2', name: '别人的空间', status: 'active' })
  data.WishList.push({ _id: 'other-wish', _openid: 'c', spaceId: 'space-2', content: '不能删除' })
  const deletedFileBatches = []
  const w = world(Date.parse('2026-09-16T04:00:00.000Z'), data, {
    deleteFiles: async fileIds => { deletedFileBatches.push([...fileIds]) },
  })

  const requested = await w.service.execute('requestSpaceDeletion', {}, 'a')
  await w.service.execute('approveSpaceDeletion', { operationId: requested.operationId }, 'b')
  w.advanceBy(24 * HOUR + 1)
  await w.service.execute('startSpacePurge', { operationId: requested.operationId }, 'a')

  let previousRemoved = 0
  let result = { phase: 'purging' }
  for (let attempt = 0; attempt < 30 && result.phase !== 'complete'; attempt += 1) {
    result = await w.service.execute('continueSpacePurge', { operationId: requested.operationId }, 'a')
    if (result.progress) {
      assert.ok(result.progress.removedCount - previousRemoved <= 20, '单次最多删除 20 条数据库记录')
      previousRemoved = result.progress.removedCount
    }
  }

  assert.equal(result.phase, 'complete')
  assert.deepEqual(await w.service.execute('continueSpacePurge', { operationId: requested.operationId }, 'a'), result, '完成响应丢失后重试仍返回完成')
  assert.equal(w.store.data.CoupleSpaceList.some(space => space._id === 'space-1'), false)
  assert.equal(w.store.data.CoupleSpaceList.some(space => space._id === 'space-2'), true)
  assert.equal(w.store.data.WishList.some(item => item._id === 'other-wish'), true)
  assert.equal(w.store.data.UserList.find(user => user._openid === 'a').spaceId, '')
  assert.equal(w.store.data.UserList.find(user => user._openid === 'b').spaceId, '')
  assert.equal(w.store.data.UserList.find(user => user._openid === 'a').credit, 0)
  assert.equal(w.store.data.UserList.find(user => user._openid === 'b').credit, 0)
  assert.deepEqual(deletedFileBatches.flat().sort(), [
    'cloud://env/couples/space-1/records/0.jpg',
    'cloud://env/couples/space-1/records/1.jpg',
  ])
})

test('云文件删除失败时保留数据库记录和清理进度，重试后可以继续', async () => {
  const data = pairedSpace()
  data.MemoryPostList.push({
    _id: 'post-photo',
    _openid: 'a',
    spaceId: 'space-1',
    content: '带图记录',
    imageFileId: 'cloud://env/couples/space-1/records/photo.jpg',
  })
  data.CoupleSpaceList[0].status = 'deleting'
  data.CoupleSpaceList[0].deletion = {
    operationId: 'purge-retry',
    requestedBy: 'a',
    requestedAt: isoAt(),
    approvedBy: ['a', 'b'],
    phase: 'purging',
    cooldownEndsAt: isoAt(),
    progress: { orderVersion: 2, collectionIndex: PURGE_COLLECTIONS.indexOf('MemoryPostList'), removedCount: 0, filesDeleted: 0 },
  }
  let attempts = 0
  const w = world(Date.parse('2026-09-16T04:00:00.000Z'), data, {
    deleteFiles: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('storage unavailable')
    },
  })

  await assert.rejects(() => w.service.execute('continueSpacePurge', { operationId: 'purge-retry' }, 'a'), /storage unavailable/)
  assert.equal(w.store.data.MemoryPostList.length, 1)
  assert.equal(w.store.data.CoupleSpaceList[0].deletion.progress.removedCount, 0)

  const resumed = await w.service.execute('continueSpacePurge', { operationId: 'purge-retry' }, 'a')
  assert.equal(resumed.phase, 'purging')
  assert.equal(w.store.data.MemoryPostList.length, 0)
  assert.equal(resumed.progress.removedCount, 1)
  assert.equal(resumed.progress.filesDeleted, 1)
})

test('最终清理的两个并发重试都稳定返回 complete', async () => {
  const data = pairedSpace()
  data.CoupleSpaceList[0].status = 'deleting'
  data.CoupleSpaceList[0].deletion = {
    operationId: 'concurrent-complete', requestedBy: 'a', approvedBy: ['a', 'b'], phase: 'purging', cooldownEndsAt: isoAt(),
    progress: { orderVersion: 2, collectionIndex: PURGE_COLLECTIONS.length, removedCount: 3, filesDeleted: 0 },
  }
  const w = world(Date.parse('2026-09-16T04:00:00.000Z'), data)
  const results = await Promise.all([
    w.service.execute('continueSpacePurge', { operationId: 'concurrent-complete' }, 'a'),
    w.service.execute('continueSpacePurge', { operationId: 'concurrent-complete' }, 'a'),
  ])
  assert.deepEqual(results.map(item => item.phase), ['complete', 'complete'])
})

test('注销清理绝不删除其他空间的图片引用，但仍能移除本空间坏记录', async () => {
  const data = pairedSpace()
  data.MemoryPostList.push({ _id: 'bad-ref', _openid: 'a', spaceId: 'space-1', content: '坏引用', imageFileId: 'cloud://env/couples/space-2/records/private.jpg' })
  data.CoupleSpaceList[0].status = 'deleting'
  data.CoupleSpaceList[0].deletion = { operationId: 'bad-reference', requestedBy: 'a', approvedBy: ['a', 'b'], phase: 'purging', cooldownEndsAt: isoAt(), progress: { orderVersion: 2, collectionIndex: PURGE_COLLECTIONS.indexOf('MemoryPostList'), removedCount: 0, filesDeleted: 0 } }
  const deleted = []
  const w = world(Date.parse('2026-09-16T04:00:00.000Z'), data, { deleteFiles: async ids => deleted.push(...ids) })
  const result = await w.service.execute('continueSpacePurge', { operationId: 'bad-reference' }, 'a')
  assert.deepEqual(deleted, [])
  assert.equal(w.store.data.MemoryPostList.length, 0)
  assert.equal(result.progress.filesDeleted, 0)
})

test('文件台账中的孤儿图片会在注销时被清理', async () => {
  const data = pairedSpace()
  data.SpaceFileList = [{ _id: 'file-orphan', spaceId: 'space-1', fileId: 'cloud://env/couples/space-1/records/orphan.jpg' }]
  data.CoupleSpaceList[0].status = 'deleting'
  data.CoupleSpaceList[0].deletion = { operationId: 'orphan-ledger', requestedBy: 'a', approvedBy: ['a', 'b'], phase: 'purging', cooldownEndsAt: isoAt(), progress: { orderVersion: 2, collectionIndex: PURGE_COLLECTIONS.indexOf('SpaceFileList'), removedCount: 0, filesDeleted: 0 } }
  const deleted = []
  const w = world(Date.parse('2026-09-16T04:00:00.000Z'), data, { deleteFiles: async ids => deleted.push(...ids) })
  const result = await w.service.execute('continueSpacePurge', { operationId: 'orphan-ledger' }, 'a')
  assert.deepEqual(deleted, ['cloud://env/couples/space-1/records/orphan.jpg'])
  assert.equal(w.store.data.SpaceFileList.length, 0)
  assert.equal(result.progress.filesDeleted, 1)
})

test('图片清理失败只标记脱敏阶段并保留台账和进度', async () => {
  const data = pairedSpace()
  data.SpaceFileList = [{ _id: 'orphan', spaceId: 'space-1', fileId: 'cloud://env/couples/space-1/records/orphan.jpg' }]
  data.CoupleSpaceList[0].status = 'deleting'
  data.CoupleSpaceList[0].deletion = {
    operationId: 'inspect-failure', requestedBy: 'a', approvedBy: ['a', 'b'], phase: 'purging', cooldownEndsAt: isoAt(),
    progress: { orderVersion: 2, collectionIndex: PURGE_COLLECTIONS.indexOf('SpaceFileList'), removedCount: 5, filesDeleted: 0 },
  }
  const w = world(Date.parse('2026-09-16T04:00:00.000Z'), data, {
    deleteFiles: async () => { throw Object.assign(new Error('storage failed'), { code: 'FILE_DELETE_FAILED' }) },
  })
  await assert.rejects(
    () => w.service.execute('continueSpacePurge', { operationId: 'inspect-failure' }, 'a'),
    error => error.code === 'FILE_DELETE_FAILED' && error.diagnosticStage === 'DELETE_CLOUD_FILE',
  )
  assert.equal(w.store.data.SpaceFileList.length, 1)
  assert.equal(w.store.data.CoupleSpaceList[0].deletion.progress.collectionIndex, PURGE_COLLECTIONS.indexOf('SpaceFileList'))
  assert.equal(w.store.data.CoupleSpaceList[0].deletion.progress.removedCount, 5)
})

test('迁移脚本确认归属的旧路径图片可由受信任台账安全清理', async () => {
  const data = pairedSpace()
  data.SpaceFileList = [{ _id: 'legacy-file', spaceId: 'space-1', fileId: 'cloud://env/records/old.jpg', legacyTrusted: true }]
  data.CoupleSpaceList[0].status = 'deleting'
  data.CoupleSpaceList[0].deletion = { operationId: 'legacy-purge', requestedBy: 'a', approvedBy: ['a', 'b'], phase: 'purging', cooldownEndsAt: isoAt(), progress: { orderVersion: 2, collectionIndex: PURGE_COLLECTIONS.indexOf('SpaceFileList'), removedCount: 0, filesDeleted: 0 } }
  const deleted = []
  const w = world(Date.parse('2026-09-16T04:00:00.000Z'), data, { deleteFiles: async ids => deleted.push(...ids) })
  await w.service.execute('continueSpacePurge', { operationId: 'legacy-purge' }, 'a')
  assert.deepEqual(deleted, ['cloud://env/records/old.jpg'])
})

test('updateSpace 只改空间配置，并且沿用同一套校验', async () => {
  const w = world()
  await createOwnSpace(w, 'a')

  const updated = await w.service.execute('updateSpace', { name: '新名字', anniversaryDate: '2026-05-20' }, 'a')
  assert.deepEqual(updated, { name: '新名字', anniversaryDate: '2026-05-20' })
  assert.equal(w.store.data.CoupleSpaceList[0].name, '新名字')

  await assert.rejects(
    () => w.service.execute('updateSpace', { anniversaryDate: '2027-01-01' }, 'a'),
    error => error.code === 'INVALID_ANNIVERSARY',
  )
  await assert.rejects(
    () => w.service.execute('updateSpace', { name: '' }, 'a'),
    error => error.code === 'INVALID_SPACE_NAME',
  )

  // 没空间的人不能改别人的空间
  await w.service.execute('updateProfile', { displayName: '小柚', identityNoticeAccepted: true }, 'b')
  await assert.rejects(() => w.service.execute('updateSpace', { name: '偷改' }, 'b'), error => error.code === 'NO_SPACE')
})

test('伴侣关系由 spaceId 决定：同一个空间只认一名 active 伴侣', async () => {
  const store = new MemoryStore(pairedSpace())
  const service = createService(store, () => isoAt(), async () => ({ reply: '', model: 'test' }))

  const bootstrap = await service.execute('getBootstrap', {}, 'a')
  assert.equal(bootstrap.partner.openid, 'b')

  // 把伴侣标成已离开，页面就应该拿到 null，而不是硬凑一个「对方」
  store.data.UserList[1] = { ...store.data.UserList[1], memberStatus: 'left' }
  const afterLeft = await service.execute('getBootstrap', {}, 'a')
  assert.equal(afterLeft.partner, null)
})
