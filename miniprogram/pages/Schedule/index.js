const { getShareMessage } = require('../../utils/share.js')
const { DAY_LABELS, PERIODS } = require('../../utils/schedule.js')
const { toggleBlock, coursesFromBlocks } = require('../../utils/schedule-fallback.js')
const { validatePickedImage } = require('../../utils/space.js')

// 课表不再写死在代码包里：真实的课程属于用户数据，只从云端 ScheduleList 按空间读取。
// 这里只负责「把同一空间的两位成员和各自的课程渲染出来」。
const MASCOTS = ['../../images/brand/mascot-a.png', '../../images/brand/mascot-b.png']
const TAGLINES = ['自己的安排，自己说了算', '忙碌也要记得休息']
const ACCENTS = ['rose', 'mint']

function todayValue() {
  const day = new Date().getDay()
  return day === 0 ? 7 : day
}

function suggestedTerm(date = new Date()) {
  const month = date.getMonth() + 1
  const year = date.getFullYear() - (month <= 2 ? 1 : 0)
  return `${year} ${month <= 2 || month >= 9 ? '秋' : '春'}`
}

function reviewDays(courses) {
  return DAY_LABELS.map(day => ({
    value: day.value,
    label: day.label,
    courses: courses.map((course, index) => ({ ...course, index })).filter(course => Number(course.day) === day.value),
  })).filter(day => day.courses.length)
}

function manualPeriodItems(day, keys) {
  return PERIODS.map((label, index) => ({
    value: index + 1, label,
    selected: keys.includes(`${day}:${index + 1}`),
  }))
}

function memberEntry(member, index) {
  return {
    openid: member.openid,
    name: member.displayName || (index === 0 ? '我' : '对方'),
    mascot: MASCOTS[index % MASCOTS.length],
    tagline: TAGLINES[index % TAGLINES.length],
    accent: ACCENTS[index % ACCENTS.length],
    days: {},
  }
}

Page({
  data: {
    navTop: 40,
    heroTop: 92,
    enabled: false,
    canImport: true,
    members: [],
    ownerIndex: 0,
    selectedDay: todayValue(),
    days: DAY_LABELS,
    courses: [],
    selectedDayLabel: '',
    ownerName: '',
    accent: 'rose',
    subtitle: '把忙碌的日子也放在一起',
    emptyTitle: '课表还没有开启',
    emptyNote: '课表是可选功能，还没有自己的课表数据',
    importImagePath: '',
    importRecognized: false,
    importConsent: false,
    importCourses: [],
    importMode: 'ocr',
    importSkipped: 0,
    manualBlocks: [],
    manualSelectedDay: todayValue(),
    manualPeriodItems: manualPeriodItems(todayValue(), []),
    reviewDays: [],
    importEditingIndex: -1,
    importTerm: '',
    importError: '',
    importing: false,
    choosingImport: false,
    savingImport: false,
    hasMySchedule: false,
    scheduleLoaded: false,
    scheduleLoadError: '',
    importExpanded: true,
    importUserExpanded: false,
  },
  onLoad() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const menu = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect()
      const navTop = Math.max(Number(info.statusBarHeight) || 24, menu && menu.top || 0)
      this.setData({ navTop, heroTop: Math.max(navTop + 52, menu && menu.bottom + 24 || 0) })
    } catch (_) { /* Keep the default safe-area spacing on older clients. */ }
    const globalData = getApp().globalData || {}
    const members = []
    if (globalData.currentUser) members.push(memberEntry(globalData.currentUser, 0))
    if (globalData.partner) members.push(memberEntry(globalData.partner, 1))
    const enabled = Boolean(globalData.features && globalData.features.schedule)
    this.setData({ members, enabled, canImport: !getApp().previewMode, importTerm: suggestedTerm(), subtitle: enabled ? '把忙碌的日子也放在一起' : '课表功能还没开启' })
    this.refreshCourses()
    this.loadSchedules()
  },
  onShareAppMessage() {
    return getShareMessage()
  },
  goBack() {
    wx.navigateBack()
  },
  // 读不到就显示空状态，绝不回落到代码包里写死的课表。
  async loadSchedules() {
    let items
    try {
      const result = await getApp().api('getSchedule')
      if (!result || !Array.isArray(result.items)) throw new Error('invalid schedule response')
      items = result.items
    } catch (error) {
      this.setData({ scheduleLoadError: '课表暂时加载失败，请重试；已有课表没有被修改。' })
      return
    }
    const byOwner = {}
    items.forEach(row => {
      if (row && typeof row.openid === 'string' && row.days && typeof row.days === 'object') {
        byOwner[row.openid] = row.days
      }
    })
    const members = this.data.members.map(member => ({ ...member, days: byOwner[member.openid] || {} }))
    const self = this.data.members[0]
    const mySchedule = self && items.find(row => row && row.openid === self.openid)
    const hasMySchedule = Boolean(mySchedule)
    this.setData({
      members, hasMySchedule, scheduleLoaded: true, scheduleLoadError: '',
      importExpanded: !hasMySchedule || this.data.importUserExpanded,
      importTerm: mySchedule && mySchedule.term && !this.data.importRecognized ? mySchedule.term : (this.data.importTerm || suggestedTerm()),
    })
    this.refreshCourses()
  },
  expandImport() { this.setData({ importExpanded: true, importUserExpanded: true }) },
  useManualImport() {
    if (!this.data.importRecognized) return
    this.setData({ importMode: 'manual', importError: '' })
  },
  useRecognizedImport() {
    if (!this.data.importCourses.length) return
    this.setData({ importMode: 'ocr', importError: '' })
  },
  selectManualDay(event) {
    const day = Number(event.currentTarget.dataset.day)
    if (!Number.isInteger(day) || day < 1 || day > 7) return
    this.setData({ manualSelectedDay: day, manualPeriodItems: manualPeriodItems(day, this.data.manualBlocks) })
  },
  toggleManualBlock(event) {
    if (!this.data.importRecognized || this.data.importMode !== 'manual') return
    const blocks = toggleBlock(this.data.manualBlocks, this.data.manualSelectedDay, event.currentTarget.dataset.period)
    this.setData({ manualBlocks: blocks, manualPeriodItems: manualPeriodItems(this.data.manualSelectedDay, blocks), importError: '' })
  },
  chooseOwner(event) {
    const ownerIndex = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(ownerIndex) || !this.data.members[ownerIndex]) return
    this.setData({ ownerIndex })
    this.refreshCourses()
  },
  chooseDay(event) {
    this.setData({ selectedDay: Number(event.currentTarget.dataset.day) })
    this.refreshCourses()
  },
  chooseScheduleImage() {
    if (this.data.choosingImport || this.data.importing || this.data.savingImport) return
    if (!getApp().ensureWritable()) return
    this.setData({ choosingImport: true })
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: result => {
        const file = result.tempFiles && result.tempFiles[0]
        if (!file || !file.tempFilePath) { this.setData({ choosingImport: false }); return }
        const check = validatePickedImage(file)
        if (!check.ok) { this.setData({ choosingImport: false }); wx.showToast({ title: check.error, icon: 'none' }); return }
        wx.showModal({
          title: '本次课表识别',
          content: '同意将这张截图临时上传至腾讯云识别课表。识别后清理截图；只有你核对并确认，课程才会保存。',
          confirmText: '同意识别', cancelText: '暂不',
          success: async result => {
            this.setData({ choosingImport: false })
            if (!result || !result.confirm) return
            const previousDraft = this.data.importRecognized ? {
              importImagePath: this.data.importImagePath,
              importCourses: this.data.importCourses,
              importMode: this.data.importMode,
              importSkipped: this.data.importSkipped,
              manualBlocks: this.data.manualBlocks,
              manualSelectedDay: this.data.manualSelectedDay,
              manualPeriodItems: this.data.manualPeriodItems,
              reviewDays: this.data.reviewDays,
              importEditingIndex: this.data.importEditingIndex,
            } : null
            this.setData({ importImagePath: file.tempFilePath, importRecognized: false, importConsent: true, importCourses: [], importMode: 'ocr', importSkipped: 0, manualBlocks: [], manualPeriodItems: manualPeriodItems(this.data.manualSelectedDay, []), reviewDays: [], importEditingIndex: -1, importError: '' })
            const recognized = await this.recognizeSelectedImage()
            if ((!recognized || !this.data.importCourses.length) && previousDraft) {
              this.setData({ ...previousDraft, importRecognized: true, importError: recognized
                ? '新截图未识别出课程，已保留上一份预览；可以继续核对或重新选图。'
                : '新截图识别失败，已保留上一份预览；可以继续核对或重新选图。' })
            }
          },
          fail: () => this.setData({ choosingImport: false }),
        })
      },
      fail: () => this.setData({ choosingImport: false }),
    })
  },
  previewImportImage() {
    if (!this.data.importImagePath) return
    wx.previewImage({ current: this.data.importImagePath, urls: [this.data.importImagePath] })
  },
  setImportTerm(event) { this.setData({ importTerm: event.detail.value }) },
  toggleImportCourse(event) {
    const position = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(position) || position < 0 || position >= this.data.importCourses.length) return
    this.setData({ importEditingIndex: this.data.importEditingIndex === position ? -1 : position })
  },
  updateImportCourse(event) {
    const { index, field } = event.currentTarget.dataset
    const position = Number(index)
    if (!Number.isInteger(position) || position < 0 || position >= this.data.importCourses.length) return
    if (!['title', 'time', 'period', 'weeks', 'place', 'teacher'].includes(field)) return
    const courses = this.data.importCourses.map((course, courseIndex) => courseIndex === position
      ? { ...course, [field]: event.detail.value } : course)
    this.setData({ importCourses: courses, reviewDays: reviewDays(courses) })
  },
  updateImportDay(event) {
    const position = Number(event.currentTarget.dataset.index)
    const day = Number(event.detail.value) + 1
    if (!Number.isInteger(position) || position < 0 || position >= this.data.importCourses.length) return
    if (!Number.isInteger(day) || day < 1 || day > 7) return
    const courses = this.data.importCourses.map((course, index) => index === position ? { ...course, day } : course)
    this.setData({ importCourses: courses, reviewDays: reviewDays(courses) })
  },
  addImportCourse() {
    if (this.data.importCourses.length >= 80) return
    const courses = [...this.data.importCourses, { day: 1, title: '', time: '', period: '', weeks: '', place: '', teacher: '' }]
    this.setData({ importCourses: courses, reviewDays: reviewDays(courses), importEditingIndex: courses.length - 1 })
  },
  removeImportCourse(event) {
    const position = Number(event.currentTarget.dataset.index)
    const courses = this.data.importCourses.filter((_, index) => index !== position)
    this.setData({ importCourses: courses, reviewDays: reviewDays(courses), importEditingIndex: -1 })
  },
  cancelImport() {
    if (this.data.importing || this.data.savingImport) return
    this.setData({ importImagePath: '', importRecognized: false, importCourses: [], importMode: 'ocr', importSkipped: 0, manualBlocks: [], manualPeriodItems: manualPeriodItems(this.data.manualSelectedDay, []), reviewDays: [], importEditingIndex: -1, importError: '', importConsent: false, importUserExpanded: false, importExpanded: !this.data.hasMySchedule })
  },
  async recognizeSelectedImage() {
    if (this.data.importing || !this.data.importImagePath) return
    if (!this.data.importConsent) { this.setData({ importError: '请先同意截图识别说明' }); return }
    if (!getApp().ensureWritable()) return
    this.setData({ importing: true, importRecognized: false, importError: '', importCourses: [], reviewDays: [], importEditingIndex: -1 })
    wx.showLoading({ title: '正在识别课表' })
    let fileId = ''
    try {
      const cloud = getApp().cloud()
      const cloudPath = await getApp().spaceUploadPath('schedule-import')
      const upload = await cloud.uploadFile({ cloudPath, filePath: this.data.importImagePath })
      fileId = upload.fileID
      await getApp().api('trackSpaceFile', { fileId })
      const result = await getApp().api('recognizeScheduleImage', { fileId, consent: true })
      fileId = '' // 云端已完成严格清理；失败时才由客户端兜底清理。
      const courses = result && Array.isArray(result.courses) ? result.courses : []
      this.setData({ importRecognized: true, importCourses: courses, importMode: courses.length ? 'ocr' : 'manual', importSkipped: Number(result && result.skipped) || 0, reviewDays: reviewDays(courses), importError: courses.length ? '' : '没有识别出可靠的课程。请对照截图，按星期和节次标记有课；旧课表未被修改。' })
      return true
    } catch (error) {
      if (fileId) {
        try { await getApp().cloud().deleteFile({ fileList: [fileId] }) } catch (_) { /* 清理账本仍可在空间注销时重试 */ }
      }
      this.setData({ importRecognized: true, importMode: 'manual', importError: '自动识别暂不可用。仍可对照截图，按星期和节次标记有课；旧课表未被修改。' })
      return false
    } finally {
      wx.hideLoading()
      this.setData({ importing: false })
    }
  },
  async confirmImport() {
    if (this.data.savingImport || this.data.importing || !this.data.importRecognized || !getApp().ensureWritable()) return
    const term = this.data.importTerm.trim()
    const courses = this.data.importMode === 'manual'
      ? coursesFromBlocks(this.data.manualBlocks)
      : this.data.importCourses.map(({ day, title, time, period, weeks, place, teacher }) => ({ day, title, time, period, weeks, place, teacher }))
    if (!term || !courses.length || courses.some(course => !String(course.title || '').trim() || !Number.isInteger(Number(course.day)))) {
      this.setData({ importError: this.data.importMode === 'manual' ? '请填写学期，并至少点亮一个有课的节次' : '请填写学期，并逐条核对星期和课程名称' })
      return
    }
    this.setData({ savingImport: true, importError: '' })
    wx.showLoading({ title: '正在保存课表' })
    try {
      await getApp().api('replaceMySchedule', { term, courses, confirmed: true })
      const features = getApp().globalData.features || {}
      getApp().globalData.features = { ...features, schedule: true }
      this.setData({ enabled: true, importCourses: [], importMode: 'ocr', importSkipped: 0, manualBlocks: [], manualPeriodItems: manualPeriodItems(this.data.manualSelectedDay, []), reviewDays: [], importImagePath: '', importRecognized: false, importConsent: false, importError: '', importEditingIndex: -1, importUserExpanded: false, hasMySchedule: true, importExpanded: false })
      await this.loadSchedules()
      wx.showToast({ title: '课表已导入', icon: 'success' })
    } catch (error) {
      this.setData({ importError: (error && error.message) || '保存失败，请重试' })
    } finally {
      wx.hideLoading()
      this.setData({ savingImport: false })
    }
  },
  refreshCourses() {
    const member = this.data.members[this.data.ownerIndex]
    const dayInfo = DAY_LABELS.find(item => item.value === this.data.selectedDay)
    const dayCourses = member && member.days ? member.days[String(this.data.selectedDay)] : null
    this.setData({
      courses: Array.isArray(dayCourses) ? dayCourses.map((course, index) => ({ ...course, displayKey: `${this.data.ownerIndex}:${this.data.selectedDay}:${index}` })) : [],
      selectedDayLabel: dayInfo ? dayInfo.label : '',
      ownerName: member ? member.name : '',
      accent: member ? member.accent : 'rose',
    })
  },
})
