const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildMonth, filterMissionsForDay, isValidPlanDate } = require('../miniprogram/utils/mission-calendar.js')

test('月日历从周一开始，跨月补齐为 42 格并统计计划数', () => {
  const cells = buildMonth(2026, 10, [
    { planDate: '2026-10-01' }, { planDate: '2026-10-01' }, { planDate: '2026-10-31' },
    { title: '旧任务' },
  ])
  assert.equal(cells.length, 42)
  assert.equal(cells[0].date, '2026-09-28')
  assert.equal(cells[3].date, '2026-10-01')
  assert.equal(cells[3].count, 2)
  assert.equal(cells[33].date, '2026-10-31')
  assert.equal(cells[33].count, 1)
  assert.equal(cells[41].date, '2026-11-08')
})

test('只有明确计划在当天的任务进入当日视图，旧任务仍留在全部任务', () => {
  const rows = [
    { title: '旧任务', date: '2026-10-01' },
    { title: '今天', planDate: '2026-10-01' },
    { title: '明天', planDate: '2026-10-02' },
  ]
  assert.deepEqual(filterMissionsForDay(rows, '2026-10-01').map(item => item.title), ['今天'])
  assert.equal(rows.length, 3)
})

test('计划日期必须是真实公历日期', () => {
  assert.equal(isValidPlanDate('2026-10-01'), true)
  assert.equal(isValidPlanDate('2026-02-30'), false)
  assert.equal(isValidPlanDate('2026/10/01'), false)
})
