// 情侣空间的共享校验与文案。页面与服务端必须用同一套规则，避免两边判断不一致。
const DISPLAY_NAME_MAX = 12
const SPACE_NAME_MAX = 20
const INVITE_TOKEN_MAX = 256
// 单张图片上限。必须与云函数 shared.js 的 IMAGE_MAX_BYTES 一致，
// 两边漂移会被 tests/quotas.test.cjs 抓到。
const IMAGE_MAX_BYTES = 5 * 1024 * 1024

// 第一阶段不依赖微信头像授权，用预设头像编号。
const DEFAULT_AVATAR_KEY = 'cat'
const AVATARS = [
  { key: 'cat', glyph: '🐱', label: '小猫' },
  { key: 'rabbit', glyph: '🐰', label: '小兔' },
  { key: 'bear', glyph: '🐻', label: '小熊' },
  { key: 'fox', glyph: '🦊', label: '小狐' },
  { key: 'panda', glyph: '🐼', label: '熊猫' },
  { key: 'chick', glyph: '🐥', label: '小鸡' },
]

const SPACE_STATES = ['unpaired', 'ready', 'frozen', 'deleting']

// unpaired / frozen / deleting 需要离开首页；ready 是唯一正常渲染双人内容的状态。
const STATE_VIEWS = {
  unpaired: {
    title: '还没有自己的空间',
    message: '先设置昵称，然后创建空间，或者加入伴侣发来的邀请。',
    action: '去设置',
    route: '/pages/Setup/index',
  },
  frozen: {
    title: '空间已冻结',
    message: '现在只能查看已有内容，不能继续新增或修改。需要恢复或删除，请到空间设置发起申请。',
    action: '去空间设置',
    route: '/pages/SpaceSetting/index',
  },
  deleting: {
    title: '空间正在删除',
    message: '这个空间已经进入删除流程，只能查看，不能继续新增或修改。',
    action: '去空间设置',
    route: '/pages/SpaceSetting/index',
  },
}

const INVITE_STATUSES = ['valid', 'expired', 'used', 'full', 'occupied', 'missing']

const INVITE_VIEWS = {
  valid: {
    title: '确认加入这个空间',
    message: '确认后，你们两个人的任务、积分、记录和照片会放在同一个空间里。',
    canJoin: true,
  },
  expired: {
    title: '这条邀请已经过期',
    message: '邀请的有效期是 48 小时。请让对方在空间设置里重新生成一条，不用新建空间。',
    canJoin: false,
  },
  used: {
    title: '这条邀请已经被使用过了',
    message: '每条邀请只能使用一次。请让对方在空间设置里重新生成一条。',
    canJoin: false,
  },
  full: {
    title: '这个空间已经满员',
    message: '一个空间最多两名成员。这个空间已经有两名成员了。',
    canJoin: false,
  },
  occupied: {
    title: '你已经在自己的空间里了',
    message: '一个微信账号同一时间只能属于一个空间。请先在空间设置里解除原来的配对。',
    canJoin: false,
  },
  missing: {
    title: '没有识别到邀请信息',
    message: '请重新粘贴伴侣发来的邀请码，或者让对方重新生成一条邀请。',
    canJoin: false,
  },
}

function compact(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function countChars(value) {
  return Array.from(String(value == null ? '' : value)).length
}

function validateDisplayName(value) {
  const text = compact(value)
  if (!text) return { ok: false, value: '', error: '请先给自己取一个昵称' }
  if (countChars(text) > DISPLAY_NAME_MAX) {
    return { ok: false, value: '', error: `昵称请控制在 ${DISPLAY_NAME_MAX} 个字以内` }
  }
  return { ok: true, value: text, error: '' }
}

// 上传前先拦掉过大的图。微信压缩后仍然超限时，这里给的是能自己动手的建议。
function validatePickedImage(file) {
  const size = Number(file && file.size)
  if (!Number.isFinite(size) || size <= 0) return { ok: true, error: '' }
  if (size > IMAGE_MAX_BYTES) {
    return { ok: false, error: `图片请压缩到 ${Math.floor(IMAGE_MAX_BYTES / 1024 / 1024)}MB 以内` }
  }
  return { ok: true, error: '' }
}

function validateSpaceName(value) {
  const text = compact(value)
  if (!text) return { ok: false, value: '', error: '请给你们的空间取一个名字' }
  if (countChars(text) > SPACE_NAME_MAX) {
    return { ok: false, value: '', error: `空间名称请控制在 ${SPACE_NAME_MAX} 个字以内` }
  }
  return { ok: true, value: text, error: '' }
}

function todayText(now) {
  const date = now instanceof Date ? now : new Date()
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDateText(value) {
  const text = compact(value)
  if (!text) return { empty: true }
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!matched) return { invalid: true }
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  if (!real) return { invalid: true }
  return { value: text }
}

// 纪念日允许留空（设计稿 §4.2：允许暂时跳过）。
function validateAnniversary(value, now) {
  const parsed = parseDateText(value)
  if (parsed.empty) return { ok: true, value: '', error: '' }
  if (parsed.invalid) return { ok: false, value: '', error: '纪念日请按 2026-09-16 这样的格式填写' }
  if (parsed.value > todayText(now)) return { ok: false, value: '', error: '纪念日不能晚于今天' }
  return { ok: true, value: parsed.value, error: '' }
}

function normalizeInviteToken(value) {
  return compact(value).slice(0, INVITE_TOKEN_MAX)
}

function isSpaceState(value) {
  return SPACE_STATES.includes(value)
}

// 只有形状完整的 bootstrap 才允许驱动页面跳转，避免旧版云函数或异常返回把用户带错页。
function isBootstrap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (!isSpaceState(value.state)) return false
  if (!value.user || typeof value.user !== 'object' || Array.isArray(value.user)) return false
  if (typeof value.user.displayName !== 'string') return false
  if (typeof value.user.profileComplete !== 'boolean') return false
  if (typeof value.user.identityNoticeRequired !== 'boolean') return false
  if (typeof value.user.onboardingComplete !== 'boolean') return false
  if (value.partner !== null && value.partner !== undefined && typeof value.partner !== 'object') return false
  if (value.space !== null && value.space !== undefined && typeof value.space !== 'object') return false
  return true
}

function stateView(state) {
  return STATE_VIEWS[state] || null
}

function setupRoute(step, inviteToken) {
  const query = [`step=${encodeURIComponent(step)}`]
  const token = normalizeInviteToken(inviteToken)
  if (token) query.push(`inviteToken=${encodeURIComponent(token)}`)
  return `/pages/Setup/index?${query.join('&')}`
}

// 小程序入口只消费服务端明确下发的状态；页面不再用“有没有昵称”或缓存猜测身份。
function resolveEntry(bootstrap, inviteToken = '') {
  if (!isBootstrap(bootstrap)) return { kind: 'error', method: '', url: '' }

  const deletion = bootstrap.space && bootstrap.space.deletion
  if (deletion && deletion.phase && deletion.phase !== 'none') {
    return { kind: 'pending', method: 'redirectTo', url: '/pages/SpaceSetting/index' }
  }
  if (bootstrap.state === 'ready' && bootstrap.partner && bootstrap.space) {
    return { kind: 'home', method: 'switchTab', url: '/pages/MainPage/index' }
  }
  if (bootstrap.state === 'ready' || bootstrap.state === 'frozen' || bootstrap.state === 'deleting') {
    return { kind: 'space', method: 'redirectTo', url: '/pages/SpaceSetting/index' }
  }

  const token = normalizeInviteToken(inviteToken)
  const step = bootstrap.user.onboardingComplete === true
    ? (token ? 'join' : 'choice')
    : 'profile'
  return {
    kind: step === 'profile' ? 'onboarding' : 'unpaired',
    method: 'redirectTo',
    url: setupRoute(step, token),
  }
}

function deletionView(bootstrap) {
  const space = bootstrap && bootstrap.space
  const deletion = space && space.deletion
  if (!deletion || typeof deletion !== 'object') {
    return { mode: 'normal', title: '', message: '', primary: '', secondary: '' }
  }
  if (deletion.phase === 'legacy') {
    return {
      mode: 'legacy',
      title: '旧版申请尚未处理',
      message: '没有任何数据被删除。你可以立即撤销旧申请并恢复正常使用。',
      primary: '撤销申请并恢复使用',
      secondary: '',
    }
  }
  if (deletion.phase === 'awaiting_partner') {
    if (deletion.isRequester) {
      return {
        mode: 'awaiting-requester',
        title: '等待对方确认',
        message: '申请期间空间仍可正常使用。请对方打开小程序，到空间设置同意或拒绝；你也可以随时撤销。对方确认后会开始清理。',
        primary: '',
        secondary: '撤销注销申请',
      }
    }
    return {
      mode: 'awaiting-partner',
      title: '对方申请注销共同空间',
      message: '同意后将立即开始清理双方数据；拒绝后继续正常使用。',
      primary: '确认注销',
      secondary: '拒绝申请',
    }
  }
  if (deletion.phase === 'cooldown') {
    const ready = deletion.canFinalize === true
    return {
      mode: ready ? 'ready-to-purge' : 'cooldown',
      title: ready ? '空间待最终清理' : '空间待处理',
      message: ready
        ? '不再需要等待。确认后会清理任务、积分、记录和照片，开始后不能撤销。'
        : '空间暂时只读；请刷新状态后继续清理，清理开始前仍可撤销。',
      primary: ready ? '最终删除共同空间' : '',
      secondary: '撤销并恢复使用',
    }
  }
  if (deletion.phase === 'purging') {
    const removed = Number(deletion.progress && deletion.progress.removedCount) || 0
    return {
      mode: 'purging',
      title: '正在安全清理空间',
      message: `已经清理 ${removed} 条数据。网络中断不会丢失进度，可以继续。`,
      primary: '继续清理',
      secondary: '',
    }
  }
  return { mode: 'normal', title: '', message: '', primary: '', secondary: '' }
}

function canShowXiaoBa(bootstrap, previewMode = false) {
  if (previewMode || !bootstrap || bootstrap.state !== 'ready') return false
  if (!bootstrap.user || bootstrap.user.profileComplete !== true) return false
  if (!bootstrap.partner || typeof bootstrap.partner !== 'object') return false
  if (bootstrap.space && bootstrap.space.status && bootstrap.space.status !== 'active') return false
  return Boolean(bootstrap.features && bootstrap.features.xiaoba === true)
}

function inviteView(status) {
  return INVITE_VIEWS[status] || INVITE_VIEWS.missing
}

function avatarView(key) {
  return AVATARS.find(item => item.key === key) || AVATARS[0]
}

// 把 openid 换成显示名。页面不再自己比较 openid 猜「谁是我、谁是对方」，
// 因为身份是服务端按 spaceId 判定后随 bootstrap 下发的。
function nameOfMember(openid, currentUser, partner) {
  if (currentUser && openid === currentUser.openid) return currentUser.displayName || '我'
  if (partner && openid === partner.openid) return partner.displayName || '对方'
  return '对方'
}

function isSelf(openid, currentUser) {
  return Boolean(currentUser && typeof openid === 'string' && openid === currentUser.openid)
}

// 从启动参数里取邀请标识。任何异常都当作「没有邀请」，不让启动流程崩掉。
// api 省略时使用全局 wx，便于在页面外部复用。
function readPendingInviteToken(api) {
  try {
    const scope = api && typeof api === 'object' ? api : (typeof wx === 'undefined' ? null : wx)
    if (!scope) return ''
    const reader = typeof scope.getEnterOptionsSync === 'function'
      ? scope.getEnterOptionsSync
      : (typeof scope.getLaunchOptionsSync === 'function' ? scope.getLaunchOptionsSync : null)
    if (!reader) return ''
    const options = reader.call(scope) || {}
    const query = options.query || {}
    return normalizeInviteToken(query.inviteToken || query.invite || '')
  } catch (error) {
    return ''
  }
}

module.exports = {
  AVATARS,
  DEFAULT_AVATAR_KEY,
  DISPLAY_NAME_MAX,
  IMAGE_MAX_BYTES,
  INVITE_STATUSES,
  SPACE_NAME_MAX,
  SPACE_STATES,
  avatarView,
  canShowXiaoBa,
  countChars,
  deletionView,
  inviteView,
  isBootstrap,
  isSelf,
  isSpaceState,
  nameOfMember,
  normalizeInviteToken,
  readPendingInviteToken,
  resolveEntry,
  stateView,
  todayText,
  validateAnniversary,
  validateDisplayName,
  validatePickedImage,
  validateSpaceName,
}
