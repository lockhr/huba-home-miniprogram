// 纪念日不再写死在代码包里，一律由空间配置（CoupleSpaceList.anniversaryDate）提供。
const ONE_DAY = 24 * 60 * 60 * 1000

// 把 "2026-05-20" 解析成 UTC 时间戳；格式不合法返回 null。
function parseAnniversaryDate(value) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value.trim() : '')
  if (!matched) return null
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const stamp = Date.UTC(year, month - 1, day)
  const date = new Date(stamp)
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return real ? stamp : null
}

// 没有配置纪念日时返回 null，首页据此隐藏整个模块。
function getAnniversaryDay(anniversaryDate, now = new Date()) {
  const start = parseAnniversaryDate(anniversaryDate)
  if (start === null) return null
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(1, Math.floor((today - start) / ONE_DAY) + 1)
}

// 首页展示用的 2026.05.20 形式；没有纪念日时返回空串。
function formatAnniversaryDate(value) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value.trim() : '')
  return matched ? `${matched[1]}.${matched[2]}.${matched[3]}` : ''
}

module.exports = { formatAnniversaryDate, getAnniversaryDay, parseAnniversaryDate }
