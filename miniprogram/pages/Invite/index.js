const { getShareMessage } = require('../../utils/share.js')
const { inviteView, normalizeInviteToken, readPendingInviteToken } = require('../../utils/space.js')

Page({
  onShareAppMessage() {
    return getShareMessage()
  },

  data: {
    inviteToken: '',
    inviteTokenInput: '',
    status: '',
    viewTitle: '',
    viewMessage: '',
    spaceName: '',
    inviterName: '',
    canJoin: false,
    loading: true,
    joining: false,
    error: '',
    hasOwnSoloSpace: false,
  },

  async onLoad(options) {
    const inviteToken = normalizeInviteToken(options && options.inviteToken) || readPendingInviteToken(wx)
    this.setData({ inviteToken })
    try {
      const app = getApp()
      const bootstrap = typeof app.loadBootstrap === 'function' ? await app.loadBootstrap() : null
      if (!bootstrap || !bootstrap.user) throw new Error('暂时无法确认账号状态，请稍后重试')
      this.setData({ hasOwnSoloSpace: Boolean(bootstrap.space && !bootstrap.partner) })
      if (bootstrap.state === 'unpaired' && bootstrap.user.onboardingComplete !== true) {
        if (typeof wx.redirectTo === 'function') {
          wx.redirectTo({ url: `/pages/Setup/index?inviteToken=${encodeURIComponent(inviteToken)}` })
        }
        return
      }
    } catch (error) {
      // 身份未知时必须停下，不能先把加入按钮放出来再等服务端兜底。
      this.setData({
        loading: false,
        status: 'identity-error',
        viewTitle: '暂时无法确认账号状态',
        viewMessage: '请检查网络后重新打开这条邀请。',
        spaceName: '',
        inviterName: '',
        canJoin: false,
        error: (error && error.message) || '暂时无法确认账号状态，请稍后重试',
      })
      return
    }
    return this.loadInvite()
  },

  async loadInvite() {
    this.setData({ loading: true, error: '' })
    if (!this.data.inviteToken) {
      this.applyStatus(null)
      return
    }
    try {
      this.applyStatus(await getApp().api('getInvite', { inviteToken: this.data.inviteToken }))
    } catch (error) {
      // 读不到邀请时按无效处理，绝不冒充「可以加入」。
      this.applyStatus(null)
      this.setData({ error: (error && error.message) || '暂时读不到这条邀请，请稍后重试' })
    }
  },

  setInviteTokenInput(event) {
    this.setData({ inviteTokenInput: event.detail.value, error: '' })
  },

  async retryWithInviteToken() {
    const inviteToken = normalizeInviteToken(this.data.inviteTokenInput)
    if (!inviteToken) {
      this.setData({ error: '请先粘贴伴侣发来的邀请码' })
      return
    }
    this.setData({ inviteToken, inviteTokenInput: '' })
    await this.loadInvite()
  },

  applyStatus(result) {
    const status = result && typeof result.status === 'string' ? result.status : 'missing'
    const view = inviteView(status)
    const readable = Boolean(result) && status === 'valid'
    this.setData({
      loading: false,
      status,
      viewTitle: view.title,
      viewMessage: status === 'occupied' && this.data.hasOwnSoloSpace
        ? '你已有自己的单人空间，作为最后一名成员不能直接离开。请先到空间设置两次确认注销原空间，完成清理后再打开这条邀请。'
        : view.message,
      spaceName: readable && result.spaceName ? result.spaceName : '',
      inviterName: readable && result.inviterName ? result.inviterName : '',
      canJoin: view.canJoin && readable,
    })
  },

  async confirmJoin() {
    if (!this.data.canJoin || this.data.joining) return
    this.setData({ joining: true, error: '' })
    try {
      await getApp().api('joinSpace', { inviteToken: this.data.inviteToken })
      wx.showToast({ title: '已经在一起了', icon: 'success' })
      if (typeof wx.switchTab === 'function') wx.switchTab({ url: '/pages/MainPage/index' })
    } catch (error) {
      const message = (error && error.message) || '加入失败，请稍后重试'
      this.setData({ error: message })
      wx.showToast({ title: message, icon: 'none' })
      if (error && ['PROFILE_REQUIRED', 'IDENTITY_NOTICE_REQUIRED'].includes(error.code)) {
        if (typeof wx.redirectTo === 'function') {
          wx.redirectTo({ url: `/pages/Setup/index?inviteToken=${encodeURIComponent(this.data.inviteToken)}` })
        }
        return
      }
      await this.loadInvite()
      this.setData({ error: message })
    } finally {
      this.setData({ joining: false })
    }
  },

  goSetup() {
    if (typeof wx.redirectTo === 'function') wx.redirectTo({ url: '/pages/Setup/index' })
  },

  goOwnSpace() {
    if (typeof wx.redirectTo === 'function') wx.redirectTo({ url: '/pages/SpaceSetting/index' })
  },
})
