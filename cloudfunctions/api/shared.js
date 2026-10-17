// 云函数侧共享的错误码、常量与校验规则。
// 注意：miniprogram/utils/space.js 里有一份对应的客户端校验，两边上限必须一致，
// tests/space-isolation.test.cjs 会比对这两个文件的常量，防止两边漂移。
const crypto = require('node:crypto')

const DISPLAY_NAME_MAX = 12
const SPACE_NAME_MAX = 20
const INVITE_TTL_MS = 48 * 60 * 60 * 1000
const MAX_SPACE_MEMBERS = 2
const MAX_ELEMENT_CREDIT = 520

// ---- M4 额度与滥用控制 ----
// 每个空间每天的小八请求上限，计数写在 CoupleSpaceList.aiUsage 上。
const AI_DAILY_LIMIT = 40
// 单张图片上限。客户端直传云存储，服务端看不到文件大小，
// 所以这个数字由客户端在上传前执行，服务端只校验路径归属。
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
// 云存储路径前缀：couples/<spaceId>/...
const IMAGE_SPACE_PREFIX = 'couples/'

// 频率限制：同一账号在时间窗内允许的次数，key 与 action 同名。
// 计数器写在调用者自己的 UserList.rateLimits 上，一次读 + 至多一次写。
const RATE_LIMITS = {
  createSpace: { max: 5, windowMs: 60 * 60 * 1000 },
  regenerateInvite: { max: 5, windowMs: 60 * 60 * 1000 },
  askXiaoBa: { max: 10, windowMs: 60 * 1000 },
  addMemoryComment: { max: 20, windowMs: 60 * 1000 },
  toggleMemoryLike: { max: 60, windowMs: 60 * 1000 },
  recognizeScheduleImage: { max: 3, windowMs: 60 * 60 * 1000 },
}

const DEFAULT_AVATAR_KEY = 'cat'
const AVATAR_KEYS = ['cat', 'rabbit', 'bear', 'fox', 'panda', 'chick']

const ALLOWED_MOODS = new Set(['happy', 'loved', 'calm', 'miss', 'tired', 'sad'])
const MOOD_LABELS = { happy: '开心', loved: '被爱', calm: '平静', miss: '想念', tired: '疲惫', sad: '难过' }

const SPACE_STATUSES = ['active', 'frozen', 'deleting']
const READ_ONLY_SPACE_STATUSES = ['frozen', 'deleting']

const ERROR_MESSAGES = {
  UNAUTHORIZED: '当前微信账号没有使用权限',
  UNKNOWN_ACTION: '不支持的操作',
  INVALID_LIST: '数据类型不合法',
  INVALID_ID: '记录编号不合法',
  INVALID_TITLE: '标题需为 1 到 12 个字符',
  INVALID_DESC: '描述不能超过 100 个字符',
  INVALID_CONTENT: '心得需为 1 到 1000 个字符',
  INVALID_POST: '记录内容需为 1 到 500 个字符',
  INVALID_COMMENT: '评论需为 1 到 100 个字符',
  INVALID_WISH: '清单标题需为 1 到 30 个字符',
  INVALID_MOOD: '请选择有效的心情',
  INVALID_WERUN: '微信运动数据无效，请重新同步',
  INVALID_CATEGORY: '请选择有效的菜品分类',
  INVALID_MINUTES: '制作时间需为 1 到 300 分钟',
  INVALID_IMAGE: '菜品图片格式不合法',
  INVALID_APPEARANCE_SLOT: '请选择有效的装扮位置',
  INVALID_APPEARANCE_IMAGE: '这张图片不属于对应的装扮位置，请重新上传',
  INVALID_CREDIT: '积分需为 1 到 520 的整数',
  INVALID_PLAN_DATE: '计划日期不正确，请重新选择',
  INVALID_SCHEDULE: '课表内容不完整，请核对后再导入',
  SCHEDULE_OCR_CONSENT_REQUIRED: '请先同意将截图用于课表识别',
  SCHEDULE_OCR_UNAVAILABLE: '课表识别暂不可用，请稍后再试',
  SCHEDULE_UNAVAILABLE: '当前部署未开放课表功能',
  INVALID_VALUE: '操作参数不合法',
  REQUEST_REUSED: '这次提交的内容已改变，请重新确认后再保存',
  NOT_FOUND: '记录不存在',
  FORBIDDEN: '只能操作自己的记录',
  OWN_MISSION: '不能确认自己的任务',
  ALREADY_COMPLETED: '任务已经完成',
  OWN_ITEM: '不能购买自己的物品',
  ALREADY_BOUGHT: '物品已被购买',
  INSUFFICIENT_CREDIT: '积分不足',
  ALREADY_USED: '物品已经使用',
  USER_NOT_FOUND: '没有找到对应的用户记录',
  EMPTY_ORDER: '请至少选择一道菜',
  INVALID_AI_MESSAGES: '请把问题控制在 500 字以内',
  AI_NOT_CONFIGURED: '小八还没有完成云端密钥配置',
  AI_CONSENT_REQUIRED: '请先阅读并同意第三方 AI 数据处理说明',
  CONTENT_REJECTED: '内容未通过安全检查，请修改后再试',
  CONTENT_CHECK_UNAVAILABLE: '内容安全检查暂时不可用，请稍后再试',
  AI_BUSY: '小八现在有点忙，请稍后再试',
  INVALID_DISPLAY_NAME: '昵称需为 1 到 12 个字符',
  INVALID_AVATAR: '请选择有效的头像',
  PROFILE_REQUIRED: '请先完成昵称和头像设置',
  IDENTITY_NOTICE_REQUIRED: '请先确认使用当前微信身份',
  ACCOUNT_HAS_SPACE: '请先处理当前空间关系，再注销个人账号',
  LAST_MEMBER_MUST_DELETE_SPACE: '你是空间最后一名成员，请使用注销共同空间来安全清理数据',
  LEGACY_DELETION_RESTORE_REQUIRED: '这是旧版删除申请，请先撤销并恢复空间',
  DELETION_NOT_AWAITING_APPROVAL: '当前没有等待你确认的注销申请',
  DELETION_ALREADY_APPROVED: '你已经确认过这次注销申请',
  DELETION_NOT_CANCELLABLE: '当前注销流程已经不能撤销',
  DELETION_REQUESTER_CANNOT_REJECT: '发起人可以撤销申请，不能拒绝自己的申请',
  DELETION_PARTNER_MUST_REJECT: '请使用拒绝申请来恢复空间',
  DELETION_NOT_LEGACY: '当前空间不是旧版待处理状态',
  DELETION_NOT_READY: '当前还不能开始最终清理',
  DELETION_COOLDOWN_ACTIVE: '冷静期还没有结束，暂时不能最终删除',
  DELETION_NOT_PURGING: '当前空间还没有进入最终清理',
  DELETION_PURGE_INCOMPLETE: '空间数据还没有清理完成',
  DELETION_OPERATION_STALE: '这次操作对应的注销申请已经变化，请刷新后重试',
  FILE_DELETE_UNAVAILABLE: '暂时无法清理空间照片，请稍后重试',
  PAIR_REQUIRED: '完成双人配对后才能使用小八',
  XIAOBA_UNAVAILABLE: '这个空间暂时没有开启小八',
  INVALID_SPACE_NAME: '空间名称需为 1 到 20 个字符',
  INVALID_ANNIVERSARY: '纪念日请按 2026-09-16 的格式填写，并且不能晚于今天',
  NO_SPACE: '你还没有加入任何情侣空间',
  ALREADY_PAIRED: '你已经在一个情侣空间里了',
  SPACE_FULL: '这个空间已经有两名成员了',
  SPACE_FROZEN: '空间已冻结，现在只能查看',
  SPACE_DELETING: '空间正在等待删除，现在只能查看',
  INVALID_INVITE: '没有识别到有效的邀请',
  INVITE_EXPIRED: '这条邀请已经过期，请让对方重新生成',
  INVITE_USED: '这条邀请已经被使用过了',
  AI_QUOTA_EXCEEDED: '今天的小八次数已经用完，明天会恢复',
  TOO_MANY_REQUESTS: '操作太频繁了，请稍后再试',
  INVALID_IMAGE_SPACE: '这张图片不属于当前空间，请重新上传',
  AI_PAUSED: '小八暂时停用，其他功能不受影响',
  IMAGE_PAUSED: '暂时不能带图保存，去掉图片后仍然可以记录',
}

class BusinessError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || '操作失败')
    this.name = 'BusinessError'
    this.code = code
  }
}

function fail(code) {
  throw new BusinessError(code)
}

function compact(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function countChars(value) {
  return Array.from(String(value == null ? '' : value)).length
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
  return real ? { value: text } : { invalid: true }
}

function validateDisplayName(value) {
  const text = compact(value)
  if (!text || countChars(text) > DISPLAY_NAME_MAX) fail('INVALID_DISPLAY_NAME')
  return text
}

function validateAvatarKey(value) {
  const text = compact(value)
  if (!text) return DEFAULT_AVATAR_KEY
  if (!AVATAR_KEYS.includes(text)) fail('INVALID_AVATAR')
  return text
}

function validateSpaceName(value) {
  const text = compact(value)
  if (!text || countChars(text) > SPACE_NAME_MAX) fail('INVALID_SPACE_NAME')
  return text
}

// 纪念日允许留空（设计稿 §4.2）。
function validateAnniversary(value, now) {
  const parsed = parseDateText(value)
  if (parsed.empty) return ''
  if (parsed.invalid) fail('INVALID_ANNIVERSARY')
  if (parsed.value > todayText(now)) fail('INVALID_ANNIVERSARY')
  return parsed.value
}

function requireId(id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 128) fail('INVALID_ID')
  return id.trim()
}

// 所有共享查询都必须带上 spaceId，调用方不得覆盖。
function scoped(spaceId, query = {}) {
  return { ...query, spaceId }
}

function spaceImagePrefix(spaceId) {
  return `${IMAGE_SPACE_PREFIX}${spaceId}/`
}

// 图片只能落在自己空间的目录里：客户端直传云存储这一步服务端拦不住，
// 但可以不把别处的图片写进这个空间的记录。
function validateSpaceImage(value, spaceId) {
  const text = compact(value)
  if (!text) return ''
  if (!text.startsWith('cloud://') || text.length > 1024 || /\s/.test(text)) fail('INVALID_IMAGE')
  // fileID 形如 cloud://<环境>.<存储桶>/<对象路径>，第一个斜杠之后才是对象路径。
  // 必须是 startsWith 而不是 includes：否则 couples/<本空间>/../别处/x.jpg 会被放行。
  // 同时禁掉 .. 与空路径段，免得靠在字符串里拼路径绕过前缀判断。
  const slash = text.indexOf('/', 'cloud://'.length)
  const objectPath = slash < 0 ? '' : text.slice(slash + 1)
  const traversable = objectPath.includes('..') || objectPath.includes('//') || objectPath.startsWith('/')
  if (traversable || !objectPath.startsWith(spaceImagePrefix(spaceId))) fail('INVALID_IMAGE_SPACE')
  return text
}

// 成本告警时用环境变量切停最贵的两项：HUBA_PAUSE=ai,image
// 只停 AI 和大图，任务、积分、文字记录继续可用。
function costGuardFrom(env) {
  const raw = env && typeof env.HUBA_PAUSE === 'string' ? env.HUBA_PAUSE : ''
  const paused = new Set(raw.split(',').map(part => part.trim().toLowerCase()).filter(Boolean))
  return { ai: !paused.has('ai'), image: !paused.has('image') }
}

// 监控只写空间编号的哈希：能按空间排查成本，又不记录任何人的身份。
function anonymousSpaceRef(spaceId) {
  if (typeof spaceId !== 'string' || !spaceId) return 'no-space'
  return crypto.createHash('sha256').update(spaceId).digest('hex').slice(0, 8)
}

// 监控上报的唯一出口。字段固定为：接口、状态、错误码、耗时、空间匿名编号。
// 调用者是谁、问了什么、传了哪张图，一律不进日志。
function monitorPayload(entry) {
  const source = entry || {}
  return {
    scope: 'api',
    action: source.action || 'unknown',
    status: source.status || 'ok',
    code: source.code || '',
    ms: Number(source.ms) || 0,
    space: anonymousSpaceRef(source.spaceId),
  }
}

// 只有非业务错误才落日志：业务错误是正常流程，不值得刷屏。
// 同样不记请求正文，只留错误类型与栈。
function errorPayload(entry) {
  const source = entry || {}
  const error = source.error || {}
  return {
    scope: 'api-error',
    action: source.action || 'unknown',
    space: anonymousSpaceRef(source.spaceId),
    name: error.name,
    code: error.code || source.code || '',
    stack: error.stack,
  }
}

// 只保留错误类别。异常正文可能夹带文件地址或个人数据，不能公开给客户端。
function publicDeletionDiagnostic(error) {
  const allowedStages = new Set(['WRITE_SPACE', 'DELETE_CLOUD_FILE', 'UNKNOWN_STAGE'])
  const stage = allowedStages.has(error && error.diagnosticStage) ? error.diagnosticStage : 'UNKNOWN_STAGE'
  const rawCode = String(error && (error.errCode || error.code) || 'UNKNOWN')
  const code = /^-?\d{1,8}$/.test(rawCode) || ['FILE_DELETE_FAILED', 'SERVER_ERROR'].includes(rawCode) ? rawCode : 'UNKNOWN'
  const name = ['Error', 'CloudBaseError'].includes(error && error.name) ? error.name : 'Error'
  return `服务器异常（${stage}/${code}/${name}）`
}

function membershipOf(user) {
  if (!user || typeof user !== 'object') return null
  if (user.memberStatus && user.memberStatus !== 'active') return null
  if (typeof user.spaceId !== 'string' || !user.spaceId) return null
  return { openid: user._openid, spaceId: user.spaceId }
}

module.exports = {
  AI_DAILY_LIMIT,
  ALLOWED_MOODS,
  AVATAR_KEYS,
  BusinessError,
  DEFAULT_AVATAR_KEY,
  DISPLAY_NAME_MAX,
  ERROR_MESSAGES,
  IMAGE_MAX_BYTES,
  IMAGE_SPACE_PREFIX,
  INVITE_TTL_MS,
  MAX_SPACE_MEMBERS,
  MAX_ELEMENT_CREDIT,
  MOOD_LABELS,
  RATE_LIMITS,
  READ_ONLY_SPACE_STATUSES,
  SPACE_NAME_MAX,
  SPACE_STATUSES,
  anonymousSpaceRef,
  compact,
  costGuardFrom,
  countChars,
  errorPayload,
  publicDeletionDiagnostic,
  monitorPayload,
  fail,
  membershipOf,
  requireId,
  scoped,
  spaceImagePrefix,
  todayText,
  validateAnniversary,
  validateAvatarKey,
  validateDisplayName,
  validateSpaceImage,
  validateSpaceName,
}
