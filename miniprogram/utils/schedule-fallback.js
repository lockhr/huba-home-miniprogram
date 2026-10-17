function blockKey(day, period) {
  const dayNumber = Number(day)
  const periodNumber = Number(period)
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 7) return ''
  if (!Number.isInteger(periodNumber) || periodNumber < 1 || periodNumber > 8) return ''
  return `${dayNumber}:${periodNumber}`
}

function toggleBlock(keys, day, period) {
  const key = blockKey(day, period)
  const current = Array.isArray(keys) ? keys : []
  if (!key) return current.slice()
  return current.includes(key) ? current.filter(item => item !== key) : [...current, key]
}

function coursesFromBlocks(keys) {
  const unique = [...new Set(Array.isArray(keys) ? keys : [])]
  return unique.map(value => {
    const matched = /^(\d):([1-8])$/.exec(String(value))
    if (!matched || blockKey(matched[1], matched[2]) !== value) return null
    return {
      day: Number(matched[1]), title: '有课', time: '', period: `第${matched[2]}大节`,
      weeks: '', place: '', teacher: '',
    }
  }).filter(Boolean).sort((left, right) => left.day - right.day || Number(left.period.match(/\d+/)[0]) - Number(right.period.match(/\d+/)[0]))
}

module.exports = { toggleBlock, coursesFromBlocks }
