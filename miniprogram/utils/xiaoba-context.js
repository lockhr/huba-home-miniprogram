// 小八的客户端补充上下文。这里只放「跟谁在说话、今天几号」这类公共信息，
// 两个人的身份和课表由云函数按 spaceId 生成（设计稿 §6）。
const { DAY_LABELS, SEASON_RULE } = require('./schedule.js')

function pad(value) {
  return String(value).padStart(2, '0')
}

function buildXiaoBaContext(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const today = now.getDay() || 7
  const currentUser = options.currentUser || null
  const partner = options.partner || null
  const callerName = (currentUser && currentUser.displayName) || '我'
  const partnerName = (partner && partner.displayName) || '对方'
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const weekday = DAY_LABELS.find(day => day.value === today)

  return [
    '【当前对话背景】',
    '这是一款给两个人一起用的双人生活小程序“胡巴家长们”，每个空间只属于一对伴侣。',
    `当前时间：${date} ${weekday ? weekday.label : ''} ${pad(now.getHours())}:${pad(now.getMinutes())}。`,
    `当前提问者：${callerName}。对话中的“我”优先指${callerName}，“对方”指${partnerName}。`,
    SEASON_RULE,
  ].join('\n')
}

module.exports = { buildXiaoBaContext }
