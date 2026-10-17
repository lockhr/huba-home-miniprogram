const { test } = require('node:test')
const assert = require('node:assert/strict')
const { MemoryStore, pairedSpace } = require('./helpers/memory-store.cjs')
const { createService } = require('../cloudfunctions/api/service.js')
const { parseScheduleTable } = require('../cloudfunctions/api/schedule-import.js')

function pairedScheduleSpace() {
  const data = pairedSpace()
  data.CoupleSpaceList[0]._id = 'schedule-space'
  data.UserList.forEach(user => { user.spaceId = 'schedule-space' })
  return data
}

function scheduleService(store, options = {}) {
  return createService(store, () => '2026-09-25T10:00:00.000Z', null, {
    ...options,
    capabilities: { schedule: true, xiaoba: false },
  })
}

const table = {
  TableDetections: [{ Cells: [
    { RowTl: 0, ColTl: 0, Text: '节次' },
    { RowTl: 0, ColTl: 1, Text: '星期一' },
    { RowTl: 0, ColTl: 2, Text: '周二' },
    { RowTl: 1, ColTl: 0, Text: '第1大节 08:00-09:35' },
    { RowTl: 1, ColTl: 1, Text: '高等数学\n1-16周\nA101\n张老师', Confidence: 99 },
    { RowTl: 1, ColTl: 2, Text: '大学英语\n第1-8周\nB202', Confidence: 96 },
  ] }],
}

test('表格 OCR 按星期列提取课程并保留待核对字段', () => {
  const result = parseScheduleTable(table)
  assert.equal(result.courses.length, 2)
  assert.deepEqual(result.courses.map(item => item.day), [1, 2])
  assert.equal(result.courses[0].title, '高等数学')
  assert.equal(result.courses[0].place, 'A101')
  assert.equal(result.courses[0].period.includes('第1大节'), true)
})

test('没有明确星期表头时不能把 OCR 文本臆测为可导入课程', () => {
  const result = parseScheduleTable({ TableDetections: [{ Cells: [{ RowTl: 1, ColTl: 1, Text: '高等数学\nA101' }] }] })
  assert.equal(result.courses.length, 0)
  assert.equal(result.needsReview, true)
})

test('不同截图里的日期表头与课程前置节次也能形成待核对预览', () => {
  const result = parseScheduleTable({ TableDetections: [{ Cells: [
    { RowTl: 0, ColTl: 0, Text: '时间' },
    { RowTl: 0, ColTl: 1, Text: '周一\n09/28' },
    { RowTl: 0, ColTl: 2, Text: '星期二 09/29' },
    { RowTl: 1, ColTl: 0, Text: '第1-2节' },
    { RowTl: 1, ColTl: 1, Text: '第1-2节\n高等数学\nA101' },
    { RowTl: 1, ColTl: 2, Text: '英语\nB202' },
  ] }] })
  assert.equal(result.courses.length, 2)
  assert.equal(result.courses[0].day, 1)
  assert.equal(result.courses[0].title, '高等数学')
})

test('课程格第一行是时间时不把时间误认为课程名称', () => {
  const result = parseScheduleTable({ TableDetections: [{ Cells: [
    { RowTl: 0, ColTl: 0, Text: '节次' },
    { RowTl: 0, ColTl: 1, Text: '周一' },
    { RowTl: 0, ColTl: 2, Text: '周二' },
    { RowTl: 1, ColTl: 0, Text: '第1-2节' },
    { RowTl: 1, ColTl: 1, Text: '08:00-09:35\n高等数学\n1-16周' },
  ] }] })
  assert.equal(result.courses[0].title, '高等数学')
  assert.equal(result.courses[0].time, '08:00-09:35')
  assert.equal(result.courses[0].period, '第1-2节')
})

test('只有时间和周次的残缺单元格不能凭空生成课程', () => {
  const result = parseScheduleTable({ TableDetections: [{ Cells: [
    { RowTl: 0, ColTl: 0, Text: '节次' },
    { RowTl: 0, ColTl: 1, Text: '周一' },
    { RowTl: 0, ColTl: 2, Text: '周二' },
    { RowTl: 1, ColTl: 0, Text: '第1-2节' },
    { RowTl: 1, ColTl: 1, Text: '08:00-09:35\n1-16周' },
  ] }] })
  assert.equal(result.courses.length, 0)
})

test('确认导入只替换本人课表，不改伴侣；无效课程和只读空间均不覆盖', async () => {
  const data = pairedScheduleSpace()
  data.ScheduleList = [
    { _id: 'old-a', _openid: 'a', spaceId: 'schedule-space', term: '旧学期', days: { 1: [{ title: '旧课' }] } },
    { _id: 'keep-b', _openid: 'b', spaceId: 'schedule-space', term: '旧学期', days: { 2: [{ title: '伴侣的课' }] } },
  ]
  const store = new MemoryStore(data)
  const service = scheduleService(store)
  const input = { term: '2026-2027-1', confirmed: true, courses: [{ day: 1, title: '高等数学', time: '08:00-09:35', period: '第1大节', weeks: '1-16周', place: 'A101', teacher: '张老师' }] }
  await assert.rejects(() => service.execute('replaceMySchedule', { ...input, courses: [{ title: '没有星期' }] }, 'a'), error => error.code === 'INVALID_SCHEDULE')
  assert.equal(store.data.ScheduleList.length, 2)
  await service.execute('replaceMySchedule', input, 'a')
  assert.equal(store.data.ScheduleList.filter(row => row._openid === 'a').length, 1)
  assert.equal(store.data.ScheduleList.find(row => row._openid === 'a').days['1'][0].title, '高等数学')
  assert.equal(store.data.ScheduleList.find(row => row._openid === 'b')._id, 'keep-b')
  assert.equal(store.data.CoupleSpaceList[0].featureFlags.schedule, undefined, '导入不能自行扩大课表开放范围')
  await service.execute('replaceMySchedule', { ...input, courses: [{ day: 3, title: '新课程' }] }, 'a')
  assert.equal(store.data.ScheduleList.filter(row => row._openid === 'a').length, 1)
  assert.equal(store.data.ScheduleList.find(row => row._openid === 'a').days['3'][0].title, '新课程')
  store.data.CoupleSpaceList[0].status = 'frozen'
  await assert.rejects(() => service.execute('replaceMySchedule', input, 'b'), error => error.code === 'SPACE_FROZEN')
  assert.equal(store.data.ScheduleList.find(row => row._openid === 'b')._id, 'keep-b')
})

test('课表截图只接受本空间临时路径，识别结束清理图片', async () => {
  const store = new MemoryStore(pairedScheduleSpace())
  const deleted = []
  const service = scheduleService(store, {
    recognizeScheduleImage: async () => table,
    deleteFiles: async files => deleted.push(...files),
  })
  const fileId = 'cloud://test/couples/schedule-space/schedule-import/one.jpg'
  const result = await service.execute('recognizeScheduleImage', { fileId, consent: true }, 'a')
  assert.equal(result.courses.length, 2)
  assert.deepEqual(deleted, [fileId])
  await assert.rejects(() => service.execute('recognizeScheduleImage', { fileId: 'cloud://test/couples/space-2/schedule-import/other.jpg', consent: true }, 'a'), error => error.code === 'INVALID_IMAGE_SPACE')
})

test('识别服务失败也清理临时截图，且不会写课表', async () => {
  const store = new MemoryStore(pairedScheduleSpace())
  const deleted = []
  const service = scheduleService(store, {
    recognizeScheduleImage: async () => { throw new Error('provider unavailable') },
    deleteFiles: async files => deleted.push(...files),
  })
  const fileId = 'cloud://test/couples/schedule-space/schedule-import/fail.jpg'
  await assert.rejects(() => service.execute('recognizeScheduleImage', { fileId, consent: true }, 'a'))
  assert.deepEqual(deleted, [fileId])
  assert.equal(store.collection('ScheduleList').length, 0)
})

test('达到识别次数上限后仍清理已上传的临时截图', async () => {
  const store = new MemoryStore(pairedScheduleSpace())
  const deleted = []
  const service = scheduleService(store, {
    recognizeScheduleImage: async () => table,
    deleteFiles: async files => deleted.push(...files),
  })
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await service.execute('recognizeScheduleImage', {
      fileId: `cloud://test/couples/schedule-space/schedule-import/${attempt}.jpg`, consent: true,
    }, 'a')
  }
  const rejectedFile = 'cloud://test/couples/schedule-space/schedule-import/limited.jpg'
  await assert.rejects(() => service.execute('recognizeScheduleImage', {
    fileId: rejectedFile, consent: true,
  }, 'a'), error => error.code === 'TOO_MANY_REQUESTS')
  assert.ok(deleted.includes(rejectedFile))
})

test('识别服务不可用时仍清理已上传的临时截图', async () => {
  const store = new MemoryStore(pairedScheduleSpace())
  const deleted = []
  const service = scheduleService(store, {
    deleteFiles: async files => deleted.push(...files),
  })
  const fileId = 'cloud://test/couples/schedule-space/schedule-import/unavailable.jpg'
  await assert.rejects(() => service.execute('recognizeScheduleImage', {
    fileId, consent: true,
  }, 'a'), error => error.code === 'SCHEDULE_OCR_UNAVAILABLE')
  assert.deepEqual(deleted, [fileId])
})

test('导入前对所有可编辑课程字段执行内容安全检查', async () => {
  const store = new MemoryStore(pairedScheduleSpace())
  const reviewed = []
  const service = scheduleService(store, {
    contentSafetyRequired: true,
    moderateText: async text => reviewed.push(text),
  })
  await service.execute('replaceMySchedule', {
    term: '2026 秋', confirmed: true,
    courses: [{ day: 1, title: '数学', time: '八点', period: '第一节', weeks: '单周', place: '教室甲', teacher: '李老师' }],
  }, 'a')
  assert.match(reviewed.join('\n'), /八点/)
  assert.match(reviewed.join('\n'), /第一节/)
  assert.match(reviewed.join('\n'), /单周/)
})
