const config = require('./config.runtime.js')
const { requestAutoPartnerReminder, requestPartnerReminder } = require('./utils/subscriptions.js')
const { createReviewDemo } = require('./utils/review-demo.js')
const { createSpacePreview } = require('./utils/space-preview.js')
const { isBootstrap, nameOfMember } = require('./utils/space.js')
const { reconcileXiaoBaScope } = require('./utils/xiaoba-storage.js')
const { safeUploadFolder } = require('./utils/appearance.js')

const reviewDemo = createReviewDemo()
const spacePreview = createSpacePreview({ fallback: reviewDemo })

// 「谁是我、谁是对方」只有两个来源：云端 getBootstrap，或用户主动进入的本地预览。
// 不再有写在本地的两个 openid，也就没有「比对 openid 推断身份」这件事了。
App({
  globalData: {
    currentUser: null,
    partner: null,
    space: null,
    features: { schedule: false, dinner: true, records: true, xiaoba: true },
    spaceState: 'unpaired',
    collectionMissionList: 'MissionList',
    collectionMarketList: 'MarketList',
    collectionStorageList: 'StorageList',
    collectionUserList: 'UserList',
    maxCredit: 520,
  },
  bootstrap: null,
  cloudReady: false,
  previewMode: false,
  onLaunch() { this.initcloud() },
  initcloud() {
    if (!config.envId || !config.appId || !wx.cloud) return
    wx.cloud.init({ traceUser: true, env: config.envId })
    this.cloudReady = true
  },
  // 云环境就绪即可用。是否已配对由服务端状态决定，不再看本地有没有填两个人的身份。
  ensureConfigured() {
    return this.cloudReady
  },
  ensureWritable() {
    if (!this.previewMode) return true
    wx.showToast({ title: '预览为只读，不会保存', icon: 'none' })
    return false
  },
  // 只读预览必须由用户主动进入，请求失败时绝不自动切换（设计稿 §8）。
  enterPreview() {
    this.previewMode = true
    this.applyPreviewIdentity()
    return true
  },
  exitPreview() {
    this.previewMode = false
    return true
  },
  applyBootstrap(bootstrap) {
    reconcileXiaoBaScope(wx, bootstrap)
    const target = this.globalData
    this.bootstrap = bootstrap
    target.spaceState = bootstrap.state
    target.currentUser = bootstrap.user || null
    target.partner = bootstrap.partner || null
    target.space = bootstrap.space || null
    target.features = bootstrap.features || target.features
    return bootstrap
  },
  applyPreviewIdentity() {
    const preview = spacePreview.identity
    const target = this.globalData
    target.spaceState = preview.spaceState
    target.currentUser = preview.currentUser
    target.partner = preview.partner
    target.space = preview.space
    target.features = preview.features
    return preview
  },
  // 页面唯一的身份入口。
  async loadBootstrap() {
    const bootstrap = await this.api('getBootstrap')
    if (!isBootstrap(bootstrap)) {
      const error = new Error('云端还没有支持情侣空间，请先上传最新版云函数')
      error.code = 'BOOTSTRAP_UNAVAILABLE'
      throw error
    }
    return this.applyBootstrap(bootstrap)
  },
  isMine(openid) {
    const currentUser = this.globalData.currentUser
    return Boolean(currentUser && typeof openid === 'string' && openid === currentUser.openid)
  },
  nameOf(openid) {
    return nameOfMember(openid, this.globalData.currentUser, this.globalData.partner)
  },
  myName() {
    const currentUser = this.globalData.currentUser
    return (currentUser && currentUser.displayName) || '我'
  },
  partnerName() {
    const partner = this.globalData.partner
    return (partner && partner.displayName) || '对方'
  },
  async renewPartnerReminderSilently() {
    try {
      return await this.addPartnerReminder(false)
    } catch (error) {
      return null
    }
  },
  async addPartnerReminder(manual = true) {
    if (this.previewMode) throw reviewDemo.readOnlyError()
    if (!this.ensureConfigured() || this._reminderBusy) return null
    this._reminderBusy = true
    try {
      const status = await (manual ? requestPartnerReminder() : requestAutoPartnerReminder())
      if (!status || status.status !== 'accept') return { status: status && status.status }
      const grantId = `grant-${Date.now()}-${Math.random().toString(36).slice(2)}`
      // Retry only the idempotent registration, never request a second WeChat grant.
      let registered
      try { registered = await this.api('registerPartnerReminder', { grantId }) }
      catch (error) { registered = await this.api('registerPartnerReminder', { grantId }) }
      return { ...registered, status: 'accept' }
    } finally {
      this._reminderBusy = false
    }
  },
  cloud() {
    if (this.previewMode) throw new Error('预览模式不会上传文件')
    if (!this.cloudReady) throw new Error('请先配置小程序 AppID 和云环境')
    return wx.cloud
  },
  // 冷启动直接进业务页时 globalData.space 可能还没填，这里补一次 bootstrap。
  async ensureSpace() {
    const space = this.globalData.space
    if (space && space._id) return space
    let bootstrap = null
    try {
      bootstrap = await this.loadBootstrap()
    } catch (error) {
      bootstrap = null
    }
    const ready = bootstrap && bootstrap.state === 'ready' ? bootstrap.space : null
    if (!ready || !ready._id) {
      const error = new Error('空间还没准备好，暂时不能上传照片')
      error.code = 'NO_SPACE'
      throw error
    }
    return ready
  },
  // 云存储路径统一带空间前缀。M4 的服务端校验靠这个前缀判断
  // 「提交上来的图片是不是本空间的」，所以这里不能省。
  async spaceUploadPath(folder, extension = 'jpg') {
    const space = await this.ensureSpace()
    const random = Math.random().toString(36).slice(2, 9)
    return `couples/${space._id}/${safeUploadFolder(folder)}/${Date.now()}-${random}.${extension}`
  },
  async api(action, data = {}, cloudData = {}) {
    if (this.previewMode) return spacePreview.handle(action, data)
    if (!this.cloudReady) throw new Error('请先配置小程序 AppID 和云环境')
    const payload = { action, data }
    Object.keys(cloudData).forEach(key => {
      const cloudId = cloudData[key]
      if (cloudId) payload[key] = wx.cloud.CloudID(cloudId)
    })
    const response = await wx.cloud.callFunction({
      name: 'api',
      data: payload,
    })
    const result = response && response.result
    if (!result || result.ok !== true) {
      const error = new Error(result && result.message ? result.message : '服务器暂时不可用，请稍后重试')
      error.code = result && result.error ? result.error : 'SERVER_ERROR'
      throw error
    }
    return result.data
  },
  async database() { return this.cloud().database() },
})
