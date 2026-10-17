const DAY_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }

function dayFromHeader(value) {
  const text = String(value || '').replace(/\s/g, '')
  const matched = /^(?:星期|周)([一二三四五六日天])(?:$|\d{1,2}[\/月.\-]\d{1,2}日?$)/.exec(text)
  return matched ? DAY_DIGITS[matched[1]] : 0
}

function compact(value, maximum = 120) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, maximum)
}

function courseFromCell(cell, periodCell, day) {
  const lines = String(cell.Text || '').split(/[\r\n]+/).map(line => compact(line)).filter(Boolean)
  if (!lines.length) return null
  const weeksLine = lines.find(line => /(?:第?\d+\s*[-–—~至]\s*\d+|单|双)周/.test(line)) || ''
  const placeLine = lines.find(line => /(?:教室|教学楼|楼|[A-Z]\s?\d{2,4})/i.test(line)) || ''
  const teacherLine = lines.find(line => /老师|教师/.test(line)) || ''
  const periodPattern = /^第?\d+\s*(?:[-–—~至]\s*\d+)?\s*(?:大节|节)$/
  const timePattern = /^\d{1,2}:\d{2}\s*[-–—~至]\s*\d{1,2}:\d{2}$/
  const title = compact(lines.find(line => !periodPattern.test(line) && !timePattern.test(line) && !/(?:第?\d+\s*[-–—~至]\s*\d+|单|双)周/.test(line)) || '', 60)
  const periodSource = compact(periodCell && periodCell.Text, 80)
  const time = (periodSource.match(/\d{1,2}:\d{2}\s*[-–—~至]\s*\d{1,2}:\d{2}/) || [])[0] || lines.find(line => timePattern.test(line)) || ''
  const period = (periodSource.match(/第\s*\d+\s*大节|第?\s*\d+\s*[-–—~至]\s*\d+\s*节/) || [])[0] || lines.find(line => periodPattern.test(line)) || ''
  if (!title) return null
  return {
    day,
    title,
    time: compact(time, 40),
    period: compact(period, 40),
    weeks: compact(weeksLine, 80),
    place: compact(placeLine, 60),
    teacher: compact(teacherLine, 50),
    confidence: Number.isFinite(Number(cell.Confidence)) ? Number(cell.Confidence) : 0,
  }
}

function parseScheduleTable(result) {
  const tables = result && Array.isArray(result.TableDetections) ? result.TableDetections : []
  const courses = []
  let skipped = 0
  tables.forEach(table => {
    const cells = table && Array.isArray(table.Cells) ? table.Cells.filter(cell => cell && Number.isInteger(cell.RowTl) && Number.isInteger(cell.ColTl)) : []
    const headers = cells.map(cell => ({ cell, day: dayFromHeader(cell.Text) })).filter(item => item.day)
    if (headers.length < 2) { skipped += cells.length; return }
    const sameRow = headers.every(item => item.cell.RowTl === headers[0].cell.RowTl)
    const sameCol = headers.every(item => item.cell.ColTl === headers[0].cell.ColTl)
    if (!sameRow && !sameCol) { skipped += cells.length; return }
    const horizontal = sameRow
    const headerLine = horizontal ? headers[0].cell.RowTl : headers[0].cell.ColTl
    cells.forEach(cell => {
      if (horizontal ? cell.RowTl <= headerLine : cell.ColTl <= headerLine) return
      const matching = headers.filter(item => horizontal
        ? cell.ColTl === item.cell.ColTl && (!Number.isInteger(cell.ColBr) || cell.ColBr <= item.cell.ColTl + 1)
        : cell.RowTl === item.cell.RowTl && (!Number.isInteger(cell.RowBr) || cell.RowBr <= item.cell.RowTl + 1))
      if (matching.length !== 1) { skipped += 1; return }
      const periodCell = cells.find(item => horizontal
        ? item.RowTl === cell.RowTl && item.ColTl < Math.min(...headers.map(header => header.cell.ColTl))
        : item.ColTl === cell.ColTl && item.RowTl < Math.min(...headers.map(header => header.cell.RowTl)))
      const course = courseFromCell(cell, periodCell, matching[0].day)
      if (course) courses.push(course)
    })
  })
  return { courses: courses.slice(0, 80), needsReview: true, skipped }
}

function normalizeSchedule(input) {
  const term = compact(input && input.term, 32)
  const raw = input && input.courses
  if (!input || input.confirmed !== true || !term || !Array.isArray(raw) || raw.length < 1 || raw.length > 80) return null
  const courses = []
  for (const item of raw) {
    const day = Number(item && item.day)
    const title = compact(item && item.title, 60)
    if (!Number.isInteger(day) || day < 1 || day > 7 || !title) return null
    const time = compact(item.time, 40)
    const period = compact(item.period, 40)
    const weeks = compact(item.weeks, 80)
    const place = compact(item.place, 60)
    const teacher = compact(item.teacher, 50)
    courses.push({ day, title, time, period, weeks, place, teacher })
  }
  return { term, courses }
}

module.exports = { dayFromHeader, normalizeSchedule, parseScheduleTable }
