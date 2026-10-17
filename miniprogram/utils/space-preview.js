// M1 阶段的本地预览适配器：让三个新页面在没有云端的情况下也能真实点通。
// 只模拟空间流程相关的 action，其余读写一律交给原有只读体验数据，写入仍然被拒绝。
const { DEFAULT_AVATAR_KEY } = require('./space.js')

const PREVIEW_SELF = {
  openid: 'preview-self',
  displayName: '阿禾',
  avatarKey: DEFAULT_AVATAR_KEY,
  avatarFileId: '',
}
const PREVIEW_PARTNER = {
  openid: 'preview-partner',
  displayName: '小柚',
  avatarKey: 'rabbit',
  avatarFileId: '',
}
// 示例数据：通用日期与通用名称，不包含任何真实个人信息。
const PREVIEW_SPACE = {
  _id: 'preview-space',
  name: '我们的小屋',
  anniversaryDate: '2024-05-20',
  status: 'active',
  appearance: {
    heroImageFileId: '',
    anniversaryImageFileId: '',
    rulesImageFileId: '',
    welcomeImageFileId: '',
  },
}
const PREVIEW_FEATURES = { schedule: false, dinner: true, records: true, xiaoba: true }

const SPACE_ACTIONS = [
  'getBootstrap',
  'updateProfile',
  'createSpace',
  'getInvite',
  'joinSpace',
  'regenerateInvite',
  'updateSpace',
  'unpair',
  'requestSpaceDeletion',
  'approveSpaceDeletion',
  'rejectSpaceDeletion',
  'cancelSpaceDeletion',
  'restoreLegacyDeletingSpace',
  'startSpacePurge',
  'continueSpacePurge',
]

// 预览标识自带状态，改一个前缀就能看到对应的异常页。
function previewInviteToken(status) {
  return status && status !== 'valid' ? `preview-${status}` : 'preview-valid'
}

function inviteStatusFromToken(token) {
  const text = String(token == null ? '' : token).trim()
  if (!text) return 'missing'
  if (text.startsWith('preview-expired')) return 'expired'
  if (text.startsWith('preview-used')) return 'used'
  if (text.startsWith('preview-full')) return 'full'
  if (text.startsWith('preview-occupied')) return 'occupied'
  return 'valid'
}

function expiresAtFrom(now) {
  return new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString()
}

function createSpacePreview(options = {}) {
  const fallback = options.fallback || null
  const now = options.now instanceof Date ? options.now : new Date()
  const pad = number => String(number).padStart(2, '0')
  const stepsDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  const state = {
    phase: options.state === 'unpaired' ? 'unpaired' : 'ready',
    self: { ...PREVIEW_SELF },
    partner: { ...PREVIEW_PARTNER },
    space: { ...PREVIEW_SPACE },
    inviteToken: previewInviteToken('valid'),
    deletion: null,
  }

  function bootstrap() {
    const paired = state.phase !== 'unpaired'
    const actor = openid => ({ openid, canEditMood: openid === state.self.openid, canSyncSteps: openid === state.self.openid })
    return {
      state: state.phase,
      user: {
        ...state.self,
        ...actor(state.self.openid),
        profileComplete: Boolean(String(state.self.displayName || '').trim()),
        identityNoticeRequired: false,
        onboardingComplete: Boolean(String(state.self.displayName || '').trim()),
        credit: 88,
        mood: 'happy',
        moodUpdatedAt: now.toISOString(),
        steps: 6321,
        stepsDate,
        stepsUpdatedAt: now.toISOString(),
        reminderCredits: 3,
      },
      partner: paired ? {
        ...state.partner,
        ...actor(state.partner.openid),
        profileComplete: Boolean(String(state.partner.displayName || '').trim()),
        identityNoticeRequired: false,
        onboardingComplete: Boolean(String(state.partner.displayName || '').trim()),
        credit: 66,
        mood: 'loved',
        moodUpdatedAt: now.toISOString(),
        steps: 4888,
        stepsDate,
        stepsUpdatedAt: now.toISOString(),
        reminderCredits: 2,
      } : null,
      space: paired ? { ...state.space, deletion: state.deletion ? { ...state.deletion } : null } : null,
      features: { ...PREVIEW_FEATURES },
    }
  }

  function inviteStatus(token) {
    if (state.phase !== 'unpaired') return 'occupied'
    return inviteStatusFromToken(token)
  }

  const handlers = {
    getBootstrap() {
      return bootstrap()
    },
    updateProfile(input = {}) {
      if (typeof input.displayName === 'string' && input.displayName.trim()) {
        state.self.displayName = input.displayName.trim()
      }
      if (typeof input.avatarKey === 'string' && input.avatarKey) {
        state.self.avatarKey = input.avatarKey
      }
      return { displayName: state.self.displayName, avatarKey: state.self.avatarKey }
    },
    createSpace(input = {}) {
      const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : PREVIEW_SPACE.name
      const anniversaryDate = typeof input.anniversaryDate === 'string' ? input.anniversaryDate.trim() : ''
      state.phase = 'ready'
      state.space = { ...state.space, name, anniversaryDate }
      state.inviteToken = previewInviteToken('valid')
      return { spaceId: state.space._id, inviteToken: state.inviteToken, expiresAt: expiresAtFrom(now) }
    },
    getInvite(input = {}) {
      const status = inviteStatus(input.inviteToken)
      const readable = status === 'valid'
      return {
        status,
        spaceName: readable ? state.space.name : '',
        inviterName: readable ? state.partner.displayName : '',
      }
    },
    joinSpace(input = {}) {
      const status = inviteStatus(input.inviteToken)
      if (status !== 'valid') {
        const error = new Error(status === 'occupied'
          ? '你已经在自己的空间里了'
          : '这条邀请现在不能使用，请让对方重新生成')
        error.code = 'INVITE_UNAVAILABLE'
        throw error
      }
      state.phase = 'ready'
      return { spaceId: state.space._id }
    },
    regenerateInvite() {
      state.inviteToken = previewInviteToken('valid')
      return { inviteToken: state.inviteToken, expiresAt: expiresAtFrom(now) }
    },
    updateSpace(input = {}) {
      if (typeof input.name === 'string' && input.name.trim()) state.space.name = input.name.trim()
      if (typeof input.anniversaryDate === 'string') state.space.anniversaryDate = input.anniversaryDate.trim()
      return { name: state.space.name, anniversaryDate: state.space.anniversaryDate }
    },
    unpair() {
      state.phase = 'unpaired'
      state.deletion = null
      return { removed: true }
    },
    requestSpaceDeletion() {
      state.deletion = {
        phase: 'awaiting_partner',
        isRequester: true,
        canApprove: false,
        canReject: false,
        canCancel: true,
        cooldownEndsAt: '',
        progress: null,
      }
      return { ...state.deletion }
    },
    approveSpaceDeletion() {
      state.phase = 'deleting'
      state.space.status = 'deleting'
      state.deletion = {
        phase: 'cooldown',
        isRequester: false,
        canApprove: false,
        canReject: false,
        canCancel: true,
        canFinalize: true,
        cooldownEndsAt: now.toISOString(),
        progress: null,
      }
      return { ...state.deletion }
    },
    rejectSpaceDeletion() {
      state.deletion = null
      return { phase: 'none' }
    },
    cancelSpaceDeletion() {
      state.phase = 'ready'
      state.space.status = 'active'
      state.deletion = null
      return { phase: 'none' }
    },
    restoreLegacyDeletingSpace() {
      state.phase = 'ready'
      state.space.status = 'active'
      state.deletion = null
      return { phase: 'none' }
    },
    startSpacePurge() {
      state.phase = 'deleting'
      state.space.status = 'deleting'
      state.deletion = { phase: 'purging', canCancel: false, progress: { removedCount: 0, filesDeleted: 0 } }
      return { ...state.deletion }
    },
    continueSpacePurge() {
      state.phase = 'unpaired'
      state.deletion = null
      return { phase: 'complete', completed: true }
    },
  }

  return {
    // getter：进入预览后改了昵称，globalData 里的展示名也跟着变。
    // 形状与云端 getBootstrap 一致，页面只认这一份身份。
    get identity() {
      const snapshot = bootstrap()
      return {
        currentUser: snapshot.user,
        partner: snapshot.partner,
        space: snapshot.space,
        features: snapshot.features,
        spaceState: snapshot.state,
      }
    },
    previewInviteToken,
    snapshot() {
      return {
        phase: state.phase,
        self: { ...state.self },
        space: { ...state.space },
        inviteToken: state.inviteToken,
      }
    },
    handle(action, input = {}) {
      if (SPACE_ACTIONS.includes(action)) return handlers[action](input)
      if (fallback && typeof fallback.handle === 'function') return fallback.handle(action, input)
      const error = new Error('预览模式只展示示例内容')
      error.code = 'REVIEW_READ_ONLY'
      throw error
    },
  }
}

module.exports = { createSpacePreview, inviteStatusFromToken, previewInviteToken }
