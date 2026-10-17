const { getShareMessage } = require('../../utils/share.js')
const { formatAnniversaryDate, getAnniversaryDay } = require('../../utils/anniversary.js')
const { getPartnerReminderStatus } = require('../../utils/subscriptions.js')
const { resolveEntry } = require('../../utils/space.js')
const {
  APPEARANCE_SLOTS,
  DEFAULT_APPEARANCE_IMAGES,
  appearanceDisplayCustom,
  appearanceView,
  avatarViewModel,
  createAppearanceUploader,
} = require('../../utils/appearance.js')

const MOOD_OPTIONS = [
  { key: 'happy', emoji: '😄', label: '开心', note: '今天元气满满' },
  { key: 'loved', emoji: '🥰', label: '幸福', note: '被爱包围着' },
  { key: 'calm', emoji: '🌿', label: '平静', note: '慢慢来也很好' },
  { key: 'miss', emoji: '💭', label: '想你', note: '偷偷想你啦' },
  { key: 'tired', emoji: '😴', label: '疲惫', note: '想要一个抱抱' },
  { key: 'sad', emoji: '🥺', label: '难过', note: '陪陪我好吗' },
]

function moodView(key) {
  return MOOD_OPTIONS.find(item => item.key === key) || MOOD_OPTIONS[2]
}

function todayKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function todaySteps(user) {
  return user && user.stepsDate === todayKey() && Number.isInteger(user.steps) ? user.steps : '--'
}

// 页面只认 bootstrap 下发的成员视图，不再自己比较 openid。
function memberSlot(user) {
  const source = user || {}
  return {
    openid: source.openid || '',
    name: source.displayName || '',
    credit: Number.isFinite(source.credit) ? source.credit : 0,
    mood: moodView(source.mood),
    steps: todaySteps(source),
    canEditMood: Boolean(source.canEditMood),
    canSyncSteps: Boolean(source.canSyncSteps),
    avatar: avatarViewModel(source),
  }
}

function appearanceCustom(space) {
  const value = space && space.appearance && typeof space.appearance === 'object' ? space.appearance : {}
  return Object.fromEntries(APPEARANCE_SLOTS.map(slot => [slot.key, Boolean(value[slot.field])]))
}

function authorizeWeRun() {
  return new Promise((resolve, reject) => wx.authorize({ scope: 'scope.werun', success: resolve, fail: reject }))
}

function getWeRunCloudId() {
  return new Promise((resolve, reject) => wx.getWeRunData({
    success: result => result && result.cloudID ? resolve(result.cloudID) : reject(new Error('没有取得微信运动数据')),
    fail: reject,
  }))
}

function showModal(options) {
  return new Promise(resolve => wx.showModal({ ...options, success: resolve, fail: () => resolve({ confirm: false }) }))
}

Page({
  onShareAppMessage() {
    return getShareMessage()
  },

  data: {
    mine: memberSlot(null),
    partner: memberSlot(null),
    partnerName: '对方',
    coupleTagline: '两个人的秘密花园 ♡',
    spaceName: '',
    setupMessage: '',
    previewMode: false,
    latestRule: null,
    ruleCount: 0,
    anniversaryDay: null,
    anniversaryDateText: '',
    hasSchedule: false,
    appearance: appearanceView(null),
    appearanceCustom: appearanceCustom(null),
    appearanceDisplayCustom: appearanceDisplayCustom(null),
    appearanceOpen: false,
    appearanceBusy: false,
    appearanceBusyKey: '',
    syncingSteps: false,
    reminderReady: false,
    reminderText: '点一下，及时收到对方的下一条动态',
    reminderAction: '领取',
    reminderCredits: 0,
    partnerReminderCredits: 0,
    reminderLoaded: false,
    reminderBusy: false,
    reminderAdded: false,
    reminderError: '',
    reminderLowNotice: '',
  },
  async loadReminderStatus() {
    const status = await getPartnerReminderStatus()
    this.setData({ reminderError: status.status === 'unconfigured' ? '提醒模板尚未配置' : '' })
  },
  updateReminderCounts(currentUser, partner) {
    const count = user => Number.isInteger(user.reminderCredits) ? user.reminderCredits : (user.reminderReady ? 1 : 0)
    const own = count(currentUser)
    const other = count(partner)
    const openid = currentUser.openid || ''
    this.setData({ reminderLoaded: true, reminderCredits: own, partnerReminderCredits: other })
    const key = `huba-low-reminder-${openid}`
    let seen = {}
    try { seen = wx.getStorageSync(key) || {} } catch (error) {}
    const notices = []
    if (own > 1) seen.own = false
    else if (!seen.own) { notices.push(own === 1 ? '你只剩 1 次接收机会，记得补充' : '你的接收次数已用完，点下方按钮补充'); seen.own = true }
    if (other > 1) seen.partner = false
    else if (!seen.partner) { notices.push(`${this.data.partnerName}${other === 1 ? '只剩 1 次接收机会' : '的接收次数已用完'}，需要对方补充`); seen.partner = true }
    try { wx.setStorageSync(key, seen) } catch (error) {}
    if (notices.length) this.setData({ reminderLowNotice: notices.join('；') })
    else if (own > 1 && other > 1) this.setData({ reminderLowNotice: '' })
  },
  dismissReminderNotice() { this.setData({ reminderLowNotice: '' }) },
  async refreshReminderCounts() {
    if (this._refreshingReminder || this.data.reminderBusy) return
    this._refreshingReminder = true
    try {
      const users = await getApp().api('getUsers')
      if (!this._homeVisible || this.data.reminderBusy) return
      const own = users.find(user => user.canEditMood)
      const partner = users.find(user => !user.canEditMood)
      if (own && partner) this.updateReminderCounts(own, partner)
    } catch (error) { /* Retain the last confirmed counts; do not replace with zero. */ }
    finally { this._refreshingReminder = false }
  },
  async enablePartnerReminder() {
    if (this.data.reminderBusy) return
    this.setData({ reminderBusy: true, reminderAdded: false, reminderError: '' })
    try {
      const registered = await getApp().addPartnerReminder(true)
      if (!registered) {
        this.setData({ reminderError: '正在处理上一次，请稍后再点' })
      } else if (registered.status === 'unconfigured') {
        this.setData({ reminderError: '提醒模板尚未配置' })
      } else if (registered.status === 'accept') {
        this.setData({ reminderCredits: registered.reminderCredits, reminderLoaded: true, reminderAdded: true, reminderLowNotice: '' })
        clearTimeout(this._reminderAnimation)
        this._reminderAnimation = setTimeout(() => this.setData({ reminderAdded: false }), 850)
      } else {
        wx.showModal({
          title: '微信提醒没有开启',
          content: '你可以在小程序右上角 ··· 的设置中重新允许订阅消息。',
          confirmText: '打开设置',
          success: result => { if (result.confirm) wx.openSetting() },
        })
      }
    } catch (error) {
      this.setData({ reminderError: '本次次数未确认，请刷新查看后再试' })
    } finally {
      this.setData({ reminderBusy: false })
      await this.refreshReminderCounts()
    }
  },
  openHouseRules() {
    wx.navigateTo({ url: '/pages/HouseRules/index' })
  },
  openDinner() {
    wx.navigateTo({ url: '/pages/Dinner/index' })
  },
  openSchedule() {
    if (!this.data.hasSchedule) {
      wx.showToast({ title: '双人课表暂未开放', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/Schedule/index' })
  },
  appearanceUploader() {
    if (!this._appearanceUploader) {
      this._appearanceUploader = createAppearanceUploader({ wxApi: wx, app: getApp() })
    }
    return this._appearanceUploader
  },
  openAppearancePanel() {
    if (!getApp().ensureWritable()) return
    this.setData({ appearanceOpen: true })
  },
  closeAppearancePanel() {
    if (this.data.appearanceBusy) return
    this.setData({ appearanceOpen: false })
  },
  stopAppearanceBubble() {},
  async replaceAppearance(event) {
    const slot = event && event.currentTarget && event.currentTarget.dataset.slot
    if (!slot || this.data.appearanceBusy) return
    this.setData({ appearanceBusy: true, appearanceBusyKey: slot })
    try {
      const result = await this.appearanceUploader().replace({ kind: 'space', slot })
      if (result && !result.cancelled) {
        this.setData({
          appearance: { ...this.data.appearance, [slot]: result.imageUrl || result.imageFileId || DEFAULT_APPEARANCE_IMAGES[slot] },
          appearanceCustom: { ...this.data.appearanceCustom, [slot]: Boolean(result.imageFileId) },
          appearanceDisplayCustom: { ...this.data.appearanceDisplayCustom, [slot]: Boolean(result.imageUrl || result.imageFileId) },
        })
        wx.showToast({ title: '已换好，对方也能看到', icon: 'success' })
      }
    } catch (error) {
      wx.showToast({ title: error.message || '图片更换失败', icon: 'none' })
    } finally {
      this.setData({ appearanceBusy: false, appearanceBusyKey: '' })
    }
  },
  async resetAppearance(event) {
    const slot = event && event.currentTarget && event.currentTarget.dataset.slot
    if (!slot || this.data.appearanceBusy) return
    this.setData({ appearanceBusy: true, appearanceBusyKey: slot })
    try {
      const result = await this.appearanceUploader().reset({ kind: 'space', slot })
      if (result && !result.cancelled) {
        this.setData({
          appearance: { ...this.data.appearance, [slot]: DEFAULT_APPEARANCE_IMAGES[slot] },
          appearanceCustom: { ...this.data.appearanceCustom, [slot]: false },
          appearanceDisplayCustom: { ...this.data.appearanceDisplayCustom, [slot]: false },
        })
        wx.showToast({ title: '已恢复默认图片', icon: 'success' })
      }
    } catch (error) {
      wx.showToast({ title: error.message || '恢复失败', icon: 'none' })
    } finally {
      this.setData({ appearanceBusy: false, appearanceBusyKey: '' })
    }
  },
  async replaceMyAvatar() {
    if (this.data.appearanceBusy) return
    this.setData({ appearanceBusy: true, appearanceBusyKey: 'avatar' })
    try {
      const result = await this.appearanceUploader().replace({ kind: 'avatar' })
      if (result && !result.cancelled) {
        this.setData({ mine: { ...this.data.mine, avatar: { ...this.data.mine.avatar, imageFileId: result.imageUrl || result.imageFileId || '' } } })
        wx.showToast({ title: '头像已更新', icon: 'success' })
      }
    } catch (error) {
      wx.showToast({ title: error.message || '头像更换失败', icon: 'none' })
    } finally {
      this.setData({ appearanceBusy: false, appearanceBusyKey: '' })
    }
  },
  async resetMyAvatar() {
    if (this.data.appearanceBusy) return
    this.setData({ appearanceBusy: true, appearanceBusyKey: 'avatar' })
    try {
      const result = await this.appearanceUploader().reset({ kind: 'avatar' })
      if (result && !result.cancelled) {
        this.setData({ mine: { ...this.data.mine, avatar: { ...this.data.mine.avatar, imageFileId: '' } } })
        wx.showToast({ title: '已恢复默认头像', icon: 'success' })
      }
    } catch (error) {
      wx.showToast({ title: error.message || '恢复失败', icon: 'none' })
    } finally {
      this.setData({ appearanceBusy: false, appearanceBusyKey: '' })
    }
  },
  openSpaceSetting() {
    wx.navigateTo({ url: '/pages/SpaceSetting/index' })
  },
  openHelp() {
    wx.navigateTo({ url: '/pages/Help/index' })
  },
  async loadHouseRules() {
    const app = getApp()
    try {
      const result = await app.api('getHouseRules')
      const rules = result && Array.isArray(result.items) ? result.items : []
      this.setData({ latestRule: rules[0] || null, ruleCount: rules.length })
    } catch (error) {
      this.setData({ latestRule: null, ruleCount: 0 })
    }
  },
  chooseMood(event) {
    const { slot, editable } = event.currentTarget.dataset
    if (editable !== true && editable !== 1 && editable !== 'true') {
      wx.showToast({ title: '这是对方的心情哦', icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: MOOD_OPTIONS.map(item => `${item.emoji} ${item.label} · ${item.note}`),
      success: result => this.saveMood(slot, MOOD_OPTIONS[result.tapIndex]),
    })
  },
  async saveMood(slot, mood) {
    if (!mood) return
    getApp().renewPartnerReminderSilently()
    wx.showLoading({ title: '保存心情中' })
    try {
      const app = getApp()
      await app.api('updateMood', { mood: mood.key })
      this.setData(slot === 'A' ? { 'mine.mood': mood } : { 'partner.mood': mood })
      wx.showToast({ title: '心情已告诉对方', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message || '心情保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },
  async syncWeRun(event) {
    if (!getApp().ensureWritable()) return
    const editable = event.currentTarget.dataset.editable
    if (editable !== true && editable !== 1 && editable !== 'true') {
      wx.showToast({ title: '只能同步自己的步数哦', icon: 'none' })
      return
    }
    if (this.data.syncingSteps) return
    getApp().renewPartnerReminderSilently()
    this.setData({ syncingSteps: true })
    wx.showLoading({ title: '同步中' })
    try {
      try {
        await authorizeWeRun()
      } catch (error) {
        wx.hideLoading()
        const choice = await showModal({
          title: '开启微信运动',
          content: '需要你的微信运动权限，才能把今天的总步数同步给对方。',
          confirmText: '去设置',
        })
        if (choice.confirm) wx.openSetting()
        return
      }
      const cloudID = await getWeRunCloudId()
      const app = getApp()
      const result = await app.api('syncWeRun', {}, { weRunData: cloudID })
      const patch = app.isMine(result.callerOpenid) ? { 'mine.steps': result.steps } : { 'partner.steps': result.steps }
      this.setData(patch)
      wx.showToast({ title: '今日步数已同步', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message || '步数同步失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ syncingSteps: false })
    }
  },
  renderBootstrap(bootstrap) {
    const mine = memberSlot(bootstrap.user)
    const partner = memberSlot(bootstrap.partner)
    const space = bootstrap.space || {}
    this.setData({
      mine,
      partner,
      partnerName: partner.name || '对方',
      coupleTagline: `${mine.name || '我'}和${partner.name || '对方'} · 两个人的秘密花园 ♡`,
      spaceName: space.name || '我们的小屋',
      anniversaryDay: getAnniversaryDay(space.anniversaryDate),
      anniversaryDateText: formatAnniversaryDate(space.anniversaryDate),
      hasSchedule: Boolean(bootstrap.features && bootstrap.features.schedule),
      appearance: appearanceView(space),
      appearanceCustom: appearanceCustom(space),
      appearanceDisplayCustom: appearanceDisplayCustom(space),
      setupMessage: '',
    })
    this.updateReminderCounts(bootstrap.user, bootstrap.partner)
  },
  relaunchWelcome() {
    this.setData({ setupMessage: '' })
    if (typeof wx.reLaunch === 'function') wx.reLaunch({ url: '/pages/Welcome/index' })
  },
  leavePreview() {
    const app = getApp()
    if (app && typeof app.exitPreview === 'function') app.exitPreview()
    this.setData({ previewMode: false })
    this.relaunchWelcome()
  },
  // 首页只渲染完整双人空间；其他状态统一回欢迎页重新分流，避免出现残缺首页。
  async onShow() {
    this._homeVisible = true
    clearInterval(this._reminderPoll)
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 0 })
    const app = getApp()
    await this.loadReminderStatus()
    if (!app.ensureConfigured()) {
      this.setData({ setupMessage: '还差一点点：请先按部署指南配置小程序账号和云环境。' })
      return
    }
    let bootstrap
    try {
      bootstrap = await app.loadBootstrap()
    } catch (error) {
      this.relaunchWelcome()
      return
    }
    if (resolveEntry(bootstrap).kind !== 'home') {
      this.relaunchWelcome()
      return
    }
    this.renderBootstrap(bootstrap)
    this.setData({ previewMode: Boolean(app.previewMode) })
    this._reminderPoll = setInterval(() => this.refreshReminderCounts(), 15000)
    await this.loadHouseRules()
  },
  onHide() {
    this._homeVisible = false
    clearInterval(this._reminderPoll)
    clearTimeout(this._reminderAnimation)
  },
  onUnload() { this.onHide() },
})
