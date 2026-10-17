const path = require('node:path')
const { reserveReminder, releaseReminder } = require('./reminder-ledger')

const DEFAULT_NOTIFICATION_TIMEOUT_MS = 500
const API_RESPONSE_BUDGET_MS = 2400

function loadLocalConfig() {
  try {
    return require(path.join(__dirname, 'notification.config.local.json'))
  } catch (error) {
    return { enabled: false }
  }
}

function compact(value, maxLength = 20) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return Array.from(text).slice(0, maxLength).join('')
}

function chinaTime(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now())
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {})
  return `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日 ${parts.hour}:${parts.minute}`
}

async function titleFrom(store, list, id, fallback) {
  if (!id || !store || typeof store.getById !== 'function') return fallback
  const item = await store.getById(list, id)
  return compact(item && item.title, 20) || fallback
}

async function buildNotification(action, input = {}, result = {}, store) {
  if (action === 'updateMood' || action === 'syncWeRun') return null
  if (action === 'createHouseRule') return { event: '写下了新的家规心得', detail: compact(result.content || input.content, 20) }
  if (action === 'createDish') return { event: '加了一道新菜', detail: compact(result.title || input.title, 20) }
  if (action === 'completeDinnerOrder') {
    const names = Array.isArray(result.items) ? result.items.map(item => item && item.title).filter(Boolean).join('、') : ''
    return { event: '完成了今天的点单', detail: compact(names, 20) || '快来看看今天吃什么' }
  }
  if (action === 'createMemoryPost') return { event: '写下了新记录', detail: compact(result.content || input.content, 20) }
  if (action === 'addMemoryComment') return { event: '回复了你们的记录', detail: compact(result.content || input.content, 20) }
  if (action === 'createWish') return { event: '添加了新的愿望', detail: compact(result.title || input.title, 20) }
  if (action === 'toggleWish') {
    return {
      event: input.completed ? '完成了共同愿望' : '重新放回愿望清单',
      detail: await titleFrom(store, 'WishList', input.id, '去记录页看看吧'),
    }
  }
  if (action === 'createElement' && input.list === 'MissionList') return { event: '给你发布了新任务', detail: compact(result.title || input.title, 20) }
  if (action === 'createElement' && input.list === 'MarketList') return { event: '上架了新的心愿', detail: compact(result.title || input.title, 20) }
  if (action === 'completeMission') return { event: '完成了你的任务', detail: await titleFrom(store, 'MissionList', input.id, '快去任务页看看吧') }
  if (action === 'buyItem') return { event: '兑换了你的心愿', detail: await titleFrom(store, 'MarketList', input.id, '快去商城看看吧') }
  if (action === 'useStorage') return { event: '使用了一张兑换券', detail: await titleFrom(store, 'StorageList', input.id, '快去仓库看看吧') }
  return null
}

function templateData(config, notification, actorName, at) {
  const fields = config.fields || {}
  const values = {
    event: compact(notification.event, 20),
    actor: compact(actorName, 10),
    time: chinaTime(at),
    detail: compact(notification.detail, 20),
  }
  return Object.keys(values).reduce((data, key) => {
    const field = fields[key]
    if (typeof field === 'string' && field.trim()) data[field.trim()] = { value: values[key] }
    return data
  }, {})
}

// 伴侣不再来自本地配置文件的 users[]，而是「同一个 spaceId 里的另一名 active 成员」（设计稿 §6）。
async function resolveCouple(store, openid) {
  if (!store || typeof store.findOne !== 'function' || typeof store.findMany !== 'function') return null
  const actor = await store.findOne('UserList', { _openid: openid })
  if (!actor || typeof actor.spaceId !== 'string' || !actor.spaceId) return null
  const members = await store.findMany('UserList', { spaceId: actor.spaceId })
  const partner = members.find(user => user && typeof user._openid === 'string' && user._openid && user._openid !== openid
    && (user.memberStatus || 'active') === 'active')
  if (!partner) return null
  return { actor, partner }
}

async function sendPartnerNotification({ cloud, store, openid, action, input, result, now = () => new Date(), config = loadLocalConfig() }) {
  if (!config || config.enabled !== true || typeof config.templateId !== 'string' || !config.templateId.trim()) {
    return { sent: false, reason: 'NOT_CONFIGURED' }
  }
  const notification = await buildNotification(action, input, result, store)
  if (!notification) return { sent: false, reason: 'IGNORED_ACTION' }
  const couple = await resolveCouple(store, openid)
  if (!couple) return { sent: false, reason: 'NO_PARTNER' }
  const { actor, partner } = couple
  const sender = cloud && cloud.openapi && cloud.openapi.subscribeMessage && cloud.openapi.subscribeMessage.send
  if (typeof sender !== 'function') return { sent: false, reason: 'OPENAPI_UNAVAILABLE' }

  const reservation = await reserveReminder(store, partner, now())
  if (!reservation) return { sent: false, reason: 'NO_CREDITS' }
  if (reservation.reminderCredits <= 1) {
    notification.detail = reservation.reminderCredits === 0
      ? '本条后剩0次提醒，请回首页补充'
      : '本条后剩1次提醒，记得补充'
  }

  const payload = {
    touser: partner._openid,
    templateId: config.templateId.trim(),
    page: typeof config.page === 'string' && config.page ? config.page : 'pages/MainPage/index',
    data: templateData(config, notification, compact(actor.displayName, 10) || '对方', now()),
  }
  if (['developer', 'trial', 'formal'].includes(config.miniprogramState)) payload.miniprogramState = config.miniprogramState
  if (typeof config.lang === 'string' && config.lang) payload.lang = config.lang
  try {
    const response = await sender.call(cloud.openapi.subscribeMessage, payload)
    const code = response && (response.errCode || response.errcode)
    if (code && Number(code) !== 0) throw Object.assign(new Error('WeChat notification rejected'), { errCode: code })
  } catch (error) {
    const code = Number(error && (error.errCode || error.errcode || error.code))
    await releaseReminder(store, reservation, code === 43101)
    throw error
  }
  return { sent: true }
}

function notificationTimeoutMs(elapsedMs) {
  const elapsed = Number.isFinite(Number(elapsedMs)) ? Math.max(0, Number(elapsedMs)) : 0
  return Math.max(0, Math.min(DEFAULT_NOTIFICATION_TIMEOUT_MS, API_RESPONSE_BUDGET_MS - elapsed))
}

function safeNotificationOptions(value) {
  if (value && typeof value.warn === 'function') {
    return { logger: value, timeoutMs: DEFAULT_NOTIFICATION_TIMEOUT_MS }
  }
  const config = value && typeof value === 'object' ? value : {}
  const timeoutMs = Number(config.timeoutMs)
  return {
    logger: config.logger && typeof config.logger.warn === 'function' ? config.logger : console,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_NOTIFICATION_TIMEOUT_MS,
  }
}

async function sendPartnerNotificationSafely(options, safety = console) {
  const { logger, timeoutMs } = safeNotificationOptions(safety)
  if (timeoutMs <= 0) {
    logger.warn('partner notification skipped', 'SEND_TIMEOUT')
    return null
  }

  let timeoutId
  const delivery = Promise.resolve().then(() => sendPartnerNotification(options))
  delivery.catch(() => {})
  try {
    const outcome = await Promise.race([
      delivery.then(
        value => ({ type: 'result', value }),
        error => ({ type: 'error', error }),
      ),
      new Promise(resolve => {
        timeoutId = setTimeout(() => resolve({ type: 'timeout' }), timeoutMs)
      }),
    ])
    if (outcome.type === 'timeout') {
      logger.warn('partner notification skipped', 'SEND_TIMEOUT')
      return null
    }
    if (outcome.type === 'error') {
      const code = outcome.error && (outcome.error.errCode || outcome.error.errcode || outcome.error.code)
      logger.warn('partner notification skipped', code || 'SEND_FAILED')
      return null
    }
    return outcome.value
  } finally {
    clearTimeout(timeoutId)
  }
}

module.exports = {
  buildNotification,
  notificationTimeoutMs,
  sendPartnerNotification,
  sendPartnerNotificationSafely,
}
