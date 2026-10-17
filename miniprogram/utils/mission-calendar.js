function dateText(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function isValidPlanDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const actual = new Date(Date.UTC(year, month - 1, day))
  return actual.getUTCFullYear() === year && actual.getUTCMonth() + 1 === month && actual.getUTCDate() === day
}

function todayText(now = new Date()) {
  return dateText(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

function buildMonth(year, month, missions = []) {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const startOffset = (first.getUTCDay() + 6) % 7
  const countByDate = Object.create(null)
  missions.forEach(item => {
    if (item && isValidPlanDate(item.planDate)) countByDate[item.planDate] = (countByDate[item.planDate] || 0) + 1
  })
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, index - startOffset + 1))
    const value = dateText(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
    return { date: value, day: date.getUTCDate(), inMonth: date.getUTCMonth() + 1 === month, count: countByDate[value] || 0 }
  })
}

function filterMissionsForDay(missions, day) {
  return Array.isArray(missions) && isValidPlanDate(day) ? missions.filter(item => item && item.planDate === day) : []
}

module.exports = { buildMonth, filterMissionsForDay, isValidPlanDate, todayText }
