const { getShareMessage } = require('../../utils/share.js')
const {
  DEFAULT_AVATAR_KEY,
  normalizeInviteToken,
  readPendingInviteToken,
  todayText,
  validateAnniversary,
  validateDisplayName,
  validateSpaceName,
} = require('../../utils/space.js')

Page({
  onShareAppMessage() {
    return getShareMessage()
  },

  data: {
    step: 'profile',
    displayName: '',
    avatarKey: DEFAULT_AVATAR_KEY,
    spaceName: '',
    anniversaryDate: '',
    pendingInviteToken: '',
    joinInviteToken: '',
    today: '',
    error: '',
    busy: false,
    identityNoticeAccepted: false,
    accountRegistered: false,
    renderStatus: 'loading',
  },

  async onLoad(options) {
    this._entryOptions = options || {}
    const pendingInviteToken = normalizeInviteToken(options && options.inviteToken) || readPendingInviteToken(wx)
    const requestedStep = options && ['profile', 'choice', 'join'].includes(options.step)
      ? options.step
      : ''
    this.setData({
      today: todayText(),
      pendingInviteToken,
      joinInviteToken: pendingInviteToken,
      accountRegistered: false,
      renderStatus: 'loading',
      error: '',
    })
    try {
      const app = getApp()
      const bootstrap = typeof app.loadBootstrap === 'function' ? await app.loadBootstrap() : null
      const user = bootstrap && bootstrap.user
      if (!bootstrap || !user) throw new Error('暂时无法确认账号状态，请重新加载')
      if (bootstrap.state !== 'unpaired') {
        this.setData({ renderStatus: 'redirecting' })
        wx.redirectTo({ url: '/pages/Welcome/index' })
        return
      }

      const profileComplete = user.profileComplete === true
      const onboardingComplete = user.onboardingComplete === true
      this.setData({
        displayName: profileComplete ? String(user.displayName || '').trim() : '',
        avatarKey: typeof user.avatarKey === 'string' && user.avatarKey ? user.avatarKey : DEFAULT_AVATAR_KEY,
        identityNoticeAccepted: user.identityNoticeRequired === false,
        accountRegistered: user.registered === true,
        renderStatus: 'ready',
        step: onboardingComplete
          ? (pendingInviteToken || requestedStep === 'join' ? 'join' : 'choice')
          : 'profile',
        error: '',
      })
    } catch (error) {
      if (error && error.code === 'UNAUTHORIZED') {
        // 空间设置页会把尚未登记的微信账号带到这里；资料提交本身会完成建号。
        this.setData({ step: 'profile', identityNoticeAccepted: false, accountRegistered: false, renderStatus: 'ready', error: '' })
        return
      }
      this.setData({ accountRegistered: false, renderStatus: 'error', error: (error && error.message) || '暂时无法确认账号状态，请检查网络后重试' })
    }
  },

  retryLoad() {
    if (this.data.renderStatus !== 'error') return
    return this.onLoad(this._entryOptions)
  },

  setDisplayName(event) {
    this.setData({ displayName: event.detail.value, error: '' })
  },

  toggleIdentityNotice() {
    this.setData({ identityNoticeAccepted: !this.data.identityNoticeAccepted, error: '' })
  },

  goChoice() {
    const checked = validateDisplayName(this.data.displayName)
    if (!checked.ok) {
      this.warn(checked.error)
      return
    }
    if (!this.data.identityNoticeAccepted) {
      this.warn('请先确认使用当前微信身份')
      return
    }
    this.setData({
      displayName: checked.value,
      step: this.data.pendingInviteToken ? 'join' : 'choice',
      error: '',
    })
  },

  backToProfile() {
    this.setData({ step: 'profile', error: '' })
  },

  chooseCreate() {
    const suggestion = this.data.spaceName || `${this.data.displayName}的小屋`
    this.setData({ step: 'create', spaceName: suggestion, error: '' })
  },

  chooseJoin() {
    const token = this.data.pendingInviteToken || readPendingInviteToken(wx)
    this.setData({ step: 'join', joinInviteToken: token, error: '' })
  },

  openAccountSecurity() {
    if (!this.data.accountRegistered || !['profile', 'choice'].includes(this.data.step)) return
    wx.navigateTo({ url: '/pages/SpaceSetting/index' })
  },

  setJoinInviteToken(event) {
    this.setData({ joinInviteToken: event.detail.value, error: '' })
  },

  async submitJoin() {
    if (this.data.busy) return
    const token = normalizeInviteToken(this.data.joinInviteToken)
    if (!token) {
      this.warn('请粘贴伴侣发给你的邀请码')
      return
    }
    this.setData({ busy: true, error: '' })
    try {
      await getApp().api('updateProfile', {
        displayName: this.data.displayName,
        avatarKey: this.data.avatarKey,
        identityNoticeAccepted: this.data.identityNoticeAccepted,
      })
      this.openInvite(token)
    } catch (error) {
      this.warn((error && error.message) || '暂时无法保存资料，请稍后重试')
    } finally {
      this.setData({ busy: false })
    }
  },

  backToChoice() {
    this.setData({ step: 'choice', error: '' })
  },

  openInvite(token) {
    wx.navigateTo({ url: `/pages/Invite/index?inviteToken=${encodeURIComponent(token)}` })
  },

  setSpaceName(event) {
    this.setData({ spaceName: event.detail.value, error: '' })
  },

  setAnniversary(event) {
    this.setData({ anniversaryDate: event.detail.value, error: '' })
  },

  clearAnniversary() {
    this.setData({ anniversaryDate: '', error: '' })
  },

  async submitCreate() {
    if (this.data.busy) return
    const name = validateSpaceName(this.data.spaceName)
    if (!name.ok) {
      this.warn(name.error)
      return
    }
    const anniversary = validateAnniversary(this.data.anniversaryDate)
    if (!anniversary.ok) {
      this.warn(anniversary.error)
      return
    }
    this.setData({ busy: true })
    try {
      const app = getApp()
      await app.api('updateProfile', {
        displayName: this.data.displayName,
        avatarKey: this.data.avatarKey,
        identityNoticeAccepted: this.data.identityNoticeAccepted,
      })
      const result = await app.api('createSpace', { name: name.value, anniversaryDate: anniversary.value })
      wx.showToast({ title: '空间已创建', icon: 'success' })
      const inviteToken = normalizeInviteToken(result && result.inviteToken)
      const expiresAt = result && typeof result.expiresAt === 'string' ? result.expiresAt : ''
      if (inviteToken && typeof wx.redirectTo === 'function') {
        wx.redirectTo({
          url: `/pages/SpaceSetting/index?inviteToken=${encodeURIComponent(inviteToken)}&expiresAt=${encodeURIComponent(expiresAt)}`,
        })
      } else {
        this.enterSpace()
      }
    } catch (error) {
      this.warn(error.message || '创建失败，请稍后重试')
    } finally {
      this.setData({ busy: false })
    }
  },

  // 首页是 tabBar 页面，只能用它回去。
  enterSpace() {
    if (typeof wx.switchTab === 'function') wx.switchTab({ url: '/pages/MainPage/index' })
  },

  warn(message) {
    this.setData({ error: message })
    wx.showToast({ title: message, icon: 'none' })
  },
})
