const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadPage(api = async () => ({}), { consent = true, pendingConsent = false } = {}) {
  let page
  const calls = []
  const fileId = 'cloud://test/couples/space-1/schedule-import/one.jpg'
  const app = {
    globalData: { currentUser: { openid: 'a', displayName: '我' }, partner: { openid: 'b', displayName: '对方' }, features: { schedule: false } },
    ensureWritable: () => true,
    spaceUploadPath: async folder => `couples/space-1/${folder}/one.jpg`,
    cloud: () => ({
      uploadFile: async value => { calls.push({ action: 'upload', value }); return { fileID: fileId } },
      deleteFile: async value => { calls.push({ action: 'delete', value }) },
    }),
    api: async (action, value) => { calls.push({ action, value }); return api(action, value) },
  }
  const wx = {
    chooseMedia: options => { calls.push({ action: 'chooseMedia' }); options.success({ tempFiles: [{ tempFilePath: '/tmp/course.jpg', size: 30000 }] }) },
    showModal: options => { calls.push({ action: 'modal', value: options }); if (!pendingConsent) options.success({ confirm: consent }) },
    previewImage: options => { calls.push({ action: 'previewImage', value: options }) },
    showToast() {}, showLoading() {}, hideLoading() {}, navigateBack() {},
  }
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/Schedule/index.js'), 'utf8')
  vm.runInNewContext(source, {
    Page: value => { page = value }, getApp: () => app, wx,
    require: filename => {
      if (filename === '../../utils/share.js') return require('../miniprogram/utils/share.js')
      if (filename === '../../utils/schedule.js') return require('../miniprogram/utils/schedule.js')
      if (filename === '../../utils/schedule-fallback.js') return require('../miniprogram/utils/schedule-fallback.js')
      if (filename === '../../utils/space.js') return require('../miniprogram/utils/space.js')
      throw new Error(`unknown dependency ${filename}`)
    },
  })
  page.setData = patch => Object.assign(page.data, patch)
  return { page, calls, app, fileId }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

test('拒绝本次截图处理时不会上传或调用 OCR', async () => {
  const { page, calls } = loadPage(async () => ({}), { consent: false })
  page.chooseScheduleImage()
  await settle()
  assert.equal(calls.filter(call => call.action === 'upload' || call.action === 'recognizeScheduleImage').length, 0)
  assert.equal(page.data.importImagePath, '')
})

test('换截图时拒绝同意不会丢失此前已识别但未保存的草稿', async () => {
  const { page, calls } = loadPage(async () => ({}), { consent: false })
  page.setData({ importImagePath: '/tmp/old.jpg', importRecognized: true, importCourses: [{ day: 1, title: '旧草稿' }], importConsent: true })
  page.chooseScheduleImage()
  await settle()
  assert.equal(page.data.importImagePath, '/tmp/old.jpg')
  assert.equal(page.data.importCourses[0].title, '旧草稿')
  assert.equal(calls.filter(call => call.action === 'upload').length, 0)
})

test('新截图识别失败时仍可核对上一份未保存的草稿', async () => {
  const { page } = loadPage(async action => {
    if (action === 'recognizeScheduleImage') throw new Error('OCR unavailable')
    return {}
  })
  page.setData({ importImagePath: '/tmp/old.jpg', importRecognized: true, importCourses: [{ day: 1, title: '旧草稿' }], reviewDays: [{ value: 1, label: '周一', courses: [{ day: 1, title: '旧草稿', index: 0 }] }], importConsent: true })
  page.chooseScheduleImage()
  await settle()
  assert.equal(page.data.importRecognized, true)
  assert.equal(page.data.importCourses[0].title, '旧草稿')
  assert.match(page.data.importError, /保留/)
})

test('换图识别到零门课时仍保留上一份未保存的草稿', async () => {
  const { page } = loadPage(async action => action === 'recognizeScheduleImage' ? { courses: [] } : {})
  page.setData({ importImagePath: '/tmp/old.jpg', importRecognized: true, importCourses: [{ day: 1, title: '旧草稿' }], reviewDays: [{ value: 1, label: '周一', courses: [{ day: 1, title: '旧草稿', index: 0 }] }], importConsent: true })
  page.chooseScheduleImage()
  await settle()
  assert.equal(page.data.importRecognized, true)
  assert.equal(page.data.importImagePath, '/tmp/old.jpg')
  assert.equal(page.data.importCourses[0].title, '旧草稿')
  assert.match(page.data.importError, /保留/)
})

test('选择截图并同意后自动识别，不需要再勾选或点击识别按钮', async () => {
  const { page, calls } = loadPage(async action => action === 'recognizeScheduleImage'
    ? { courses: [{ day: 1, title: '高等数学' }] } : { items: [] })
  page.chooseScheduleImage()
  await settle()
  assert.equal(calls.filter(call => call.action === 'modal').length, 1)
  assert.equal(calls.filter(call => call.action === 'recognizeScheduleImage').length, 1)
  assert.equal(page.data.importRecognized, true)
  assert.equal(calls.filter(call => call.action === 'replaceMySchedule').length, 0)
})

test('等待本次识别同意期间重复点击不会打开第二次选图', () => {
  const { page, calls } = loadPage(async () => ({}), { pendingConsent: true })
  page.chooseScheduleImage()
  page.chooseScheduleImage()
  assert.equal(calls.filter(call => call.action === 'chooseMedia').length, 1)
  assert.equal(calls.filter(call => call.action === 'modal').length, 1)
})

test('用户可以在核对草稿时直接放大原截图，而不再上传或保存', () => {
  const { page, calls } = loadPage()
  page.setData({ importImagePath: '/tmp/course.jpg', importRecognized: true })
  assert.equal(typeof page.previewImportImage, 'function')
  page.previewImportImage()
  assert.equal(calls.find(call => call.action === 'previewImage').value.current, '/tmp/course.jpg')
  assert.equal(calls.some(call => call.action === 'upload' || call.action === 'replaceMySchedule'), false)
})

test('已有本人课表时折叠上传说明，点击重新上传才展开；对方有课表不算本人有', async () => {
  const { page } = loadPage(async action => action === 'getSchedule'
    ? { items: [{ openid: 'a', term: '2026 秋', days: { 1: [{ title: '数学' }] } }] } : {})
  page.setData({ members: [{ openid: 'a', days: {} }, { openid: 'b', days: {} }] })
  await page.loadSchedules()
  assert.equal(page.data.hasMySchedule, true)
  assert.equal(page.data.importExpanded, false)
  assert.equal(page.data.importTerm, '2026 秋')
  page.expandImport()
  assert.equal(page.data.importExpanded, true)

  const partnerOnly = loadPage(async action => action === 'getSchedule'
    ? { items: [{ openid: 'b', term: '2026 秋', days: { 1: [{ title: '英语' }] } }] } : {})
  partnerOnly.page.setData({ members: [{ openid: 'a', days: {} }, { openid: 'b', days: {} }] })
  await partnerOnly.page.loadSchedules()
  assert.equal(partnerOnly.page.data.hasMySchedule, false)
  assert.equal(partnerOnly.page.data.importExpanded, true)
})

test('课表加载失败保留原有数据并提示重试，不误判为空课表', async () => {
  const { page } = loadPage(async action => {
    if (action === 'getSchedule') throw new Error('network')
    return {}
  })
  page.setData({ hasMySchedule: true, importExpanded: false, members: [{ openid: 'a', days: { 1: [{ title: '数学' }] } }] })
  await page.loadSchedules()
  assert.equal(page.data.hasMySchedule, true)
  assert.equal(page.data.members[0].days['1'][0].title, '数学')
  assert.ok(page.data.scheduleLoadError)
})

test('课表接口响应不完整时也不能把旧课表当成空课表', async () => {
  const { page } = loadPage(async () => ({}))
  page.setData({ members: [{ openid: 'a', days: { 1: [{ title: '数学' }] } }], hasMySchedule: true, scheduleLoaded: true })
  await page.loadSchedules()
  assert.equal(page.data.hasMySchedule, true)
  assert.equal(page.data.members[0].days['1'][0].title, '数学')
  assert.ok(page.data.scheduleLoadError)
})

test('无课表时建议一个可编辑学期，不要求用户从零输入', () => {
  const { page } = loadPage()
  page.onLoad()
  assert.match(page.data.importTerm, /^\d{4} (春|秋)$/)
  page.setImportTerm({ detail: { value: '自定义学期' } })
  assert.equal(page.data.importTerm, '自定义学期')
})

test('课程预览默认收起字段，点某门课才进入编辑', () => {
  const { page } = loadPage()
  assert.equal(page.data.importEditingIndex, -1)
  page.setData({ importCourses: [{ day: 2, title: '英语' }] })
  page.toggleImportCourse({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(page.data.importEditingIndex, 0)
  page.toggleImportCourse({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(page.data.importEditingIndex, -1)
})

test('只修改识别有误的课程，星期分组随修改更新，确认时提交修正值', async () => {
  const { page, calls } = loadPage(async action => action === 'recognizeScheduleImage'
    ? { courses: [{ day: 1, title: '数学', time: '08:00-09:35' }, { day: 2, title: '英语' }] }
    : { items: [{ openid: 'a', term: '2026 秋', days: { 1: [{ title: '数学' }] } }] })
  page.setData({ members: [{ openid: 'a', days: {} }], importTerm: '2026 秋' })
  page.chooseScheduleImage()
  await settle()
  assert.deepEqual(Array.from(page.data.reviewDays, day => day.label), ['周一', '周二'])
  page.toggleImportCourse({ currentTarget: { dataset: { index: 1 } } })
  page.updateImportCourse({ currentTarget: { dataset: { index: 1, field: 'title' } }, detail: { value: '大学英语' } })
  page.updateImportDay({ currentTarget: { dataset: { index: 1 } }, detail: { value: '2' } })
  assert.deepEqual(Array.from(page.data.reviewDays, day => day.label), ['周一', '周三'])
  await page.confirmImport()
  const saved = calls.find(call => call.action === 'replaceMySchedule')
  assert.equal(saved.value.courses[1].title, '大学英语')
  assert.equal(saved.value.courses[1].day, 3)
  assert.equal(page.data.importExpanded, false)
})

test('未同意截图处理时不能上传或调用 OCR', async () => {
  const { page, calls } = loadPage()
  page.setData({ importImagePath: '/tmp/course.jpg', importConsent: false })
  await page.recognizeSelectedImage()
  assert.equal(calls.length, 0)
  assert.equal(page.data.importImagePath, '/tmp/course.jpg')
})

test('识别只形成预览，核对确认后才覆盖自己的课表', async () => {
  const { page, calls, app } = loadPage(async action => action === 'recognizeScheduleImage'
    ? { courses: [{ day: 1, title: '高等数学', time: '08:00-09:35' }], needsReview: true }
    : { items: [] })
  page.chooseScheduleImage()
  await settle()
  assert.equal(page.data.importRecognized, true)
  assert.equal(calls.filter(call => call.action === 'replaceMySchedule').length, 0)
  assert.equal(page.data.importCourses[0].title, '高等数学')
  page.setData({ importTerm: '2026 秋' })
  await page.confirmImport()
  const saved = calls.find(call => call.action === 'replaceMySchedule')
  assert.equal(saved.value.confirmed, true)
  assert.equal(saved.value.courses[0].day, 1)
  assert.equal(app.globalData.features.schedule, true)
})

test('OCR 失败不覆盖已有课表，界面允许重新选截图', async () => {
  const { page, calls } = loadPage(async action => { if (action === 'recognizeScheduleImage') throw new Error('unavailable'); return {} })
  page.chooseScheduleImage()
  await settle()
  assert.equal(calls.some(call => call.action === 'replaceMySchedule'), false)
  assert.equal(page.data.importing, false)
  assert.ok(page.data.importError)
})

test('OCR 无结果时进入可操作的手动忙碌时段模式，不自动保存空课表', async () => {
  const { page, calls } = loadPage(async action => action === 'recognizeScheduleImage' ? { courses: [], skipped: 9 } : { items: [] })
  page.chooseScheduleImage()
  await settle()
  assert.equal(page.data.importRecognized, true)
  assert.equal(page.data.importMode, 'manual')
  assert.equal(page.data.importImagePath, '/tmp/course.jpg')
  assert.equal(calls.some(call => call.action === 'replaceMySchedule'), false)
  await page.confirmImport()
  assert.equal(calls.some(call => call.action === 'replaceMySchedule'), false)
})

test('OCR 接口失败仍保留本机截图和手动兜底，不触发课表替换', async () => {
  const { page, calls } = loadPage(async action => { if (action === 'recognizeScheduleImage') throw new Error('network'); return {} })
  page.chooseScheduleImage()
  await settle()
  assert.equal(page.data.importRecognized, true)
  assert.equal(page.data.importMode, 'manual')
  assert.equal(page.data.importImagePath, '/tmp/course.jpg')
  assert.equal(calls.some(call => call.action === 'replaceMySchedule'), false)
})

test('手动点亮格子并确认只提交所选星期节次，切换模式不丢 OCR 候选', async () => {
  const { page, calls } = loadPage(async action => action === 'recognizeScheduleImage'
    ? { courses: [{ day: 1, title: 'OCR 候选' }], skipped: 2 } : { items: [] })
  page.setData({ members: [{ openid: 'a', days: {} }], importTerm: '2026 秋' })
  page.chooseScheduleImage()
  await settle()
  assert.equal(page.data.importMode, 'ocr')
  page.useManualImport()
  page.selectManualDay({ currentTarget: { dataset: { day: 2 } } })
  page.toggleManualBlock({ currentTarget: { dataset: { period: 3 } } })
  assert.deepEqual(Array.from(page.data.manualBlocks), ['2:3'])
  page.useRecognizedImport()
  assert.equal(page.data.importCourses[0].title, 'OCR 候选')
  page.useManualImport()
  await page.confirmImport()
  const saved = calls.find(call => call.action === 'replaceMySchedule')
  assert.deepEqual(Array.from(saved.value.courses, row => [row.day, row.title, row.period, row.weeks]), [[2, '有课', '第3大节', '']])
  assert.equal(saved.value.confirmed, true)
})

test('页面提供截图对照与星期节次手动核对入口，提示未确认周次', () => {
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/Schedule/index.wxml'), 'utf8')
  assert.match(source, /bindtap="useManualImport"/)
  assert.match(source, /bindtap="useRecognizedImport"/)
  assert.match(source, /bindtap="selectManualDay"/)
  assert.match(source, /bindtap="toggleManualBlock"/)
  assert.match(source, /周次.*核对/)
  assert.match(source, /原截图不作为课表保存/)
  assert.doesNotMatch(source, /原截图不会长期保存/)
})

test('同一天多个手动有课卡片使用不同渲染键，不以相同课程名复用', () => {
  const { page } = loadPage()
  page.setData({ members: [{ openid: 'a', name: '我', days: { 1: [{ title: '有课', period: '第1大节' }, { title: '有课', period: '第2大节' }] } }], ownerIndex: 0, selectedDay: 1 })
  page.refreshCourses()
  assert.notEqual(page.data.courses[0].displayKey, page.data.courses[1].displayKey)
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/Schedule/index.wxml'), 'utf8')
  assert.match(source, /class="course-card[^\n]+wx:for="\{\{courses\}\}" wx:key="displayKey"/)
})

test('课表导入 UI 使用按需编辑的星期预览，已有课表仅保留重传入口', () => {
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/Schedule/index.wxml'), 'utf8')
  assert.match(source, /hasMySchedule\s*&&\s*!importExpanded/)
  assert.match(source, /重新上传我的课表/)
  assert.match(source, /wx:for="\{\{reviewDays\}\}"/)
  assert.match(source, /importEditingIndex\s*===\s*course\.index/)
  assert.match(source, /<view wx:if="\{\{scheduleLoaded\}\}">\s*<scroll-view class="day-strip"/)
  assert.doesNotMatch(source, /checkbox-group/)
  assert.match(source, /bindtap="previewImportImage"/)
  assert.match(source, /示例作息/)
  assert.match(source, /仅供参考/)
  assert.doesNotMatch(source, /今天没有课/)
})
