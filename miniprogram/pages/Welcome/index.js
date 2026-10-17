const { getShareMessage } = require('../../utils/share.js')
const {
  normalizeInviteToken,
  readPendingInviteToken,
  resolveEntry,
} = require('../../utils/space.js')

Page({
  data: {
    status: 'loading',
    error: '',
    busy: false,
    inviteToken: '',
  },

  onShareAppMessage() {
    return getShareMessage()
  },

  onLoad(options) {
    const app = getApp()
    if (app && typeof app.exitPreview === 'function') app.exitPreview()
    const inviteToken = normalizeInviteToken(options && options.inviteToken) || readPendingInviteToken(wx)
    this.setData({ inviteToken })
    return this.loadAndRoute()
  },

  routeTo(target) {
    if (!target || !target.method || typeof wx[target.method] !== 'function') return false
    wx[target.method]({ url: target.url })
    return true
  },

  async loadAndRoute() {
    if (this.data.busy) return
    this.setData({ busy: true, status: 'loading', error: '' })
    try {
      const bootstrap = await getApp().loadBootstrap()
      const target = resolveEntry(bootstrap, this.data.inviteToken)
      if (target.kind === 'error') {
        const error = new Error('账号状态不完整，请重新加载')
        error.code = 'BOOTSTRAP_UNAVAILABLE'
        throw error
      }
      if (target.kind === 'onboarding') {
        this.setData({ busy: false, status: 'welcome' })
        return
      }
      if (!this.routeTo(target)) throw new Error('暂时无法打开下一页')
      this.setData({ busy: false })
    } catch (error) {
      this.setData({
        busy: false,
        status: 'error',
        error: '暂时没能连接到你们的空间，请检查网络后重新加载。',
      })
    }
  },

  startOnboarding() {
    if (this.data.busy) return
    const target = resolveEntry(getApp().bootstrap, this.data.inviteToken)
    if (target.kind === 'onboarding') {
      this.routeTo(target)
      return
    }
    return this.loadAndRoute()
  },

  browseDemo() {
    if (this.data.busy) return
    const app = getApp()
    if (!app || typeof app.enterPreview !== 'function' || app.enterPreview() !== true) return
    if (typeof wx.switchTab === 'function') wx.switchTab({ url: '/pages/MainPage/index' })
  },

  retryLoad() {
    return this.loadAndRoute()
  },
})
