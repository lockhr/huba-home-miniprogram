const { getShareMessage } = require('../../utils/share.js')
const { clearXiaoBaSession } = require('../../utils/xiaoba-storage.js')
const {
  avatarView,
  deletionView,
  normalizeInviteToken,
  todayText,
  validateAnniversary,
  validateSpaceName,
} = require('../../utils/space.js')

const HOME_PATH = '/pages/MainPage/index'

function confirmDialog(options) {
  return new Promise(resolve => {
    wx.showModal({
      ...options,
      success: result => resolve(Boolean(result && result.confirm)),
      fail: () => resolve(false),
    })
  })
}

function formatExpiry(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = number => String(number).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())} 前有效`
}

function clipboardFailureMessage(error) {
  const detail = error && typeof error.errMsg === 'string'
    ? error.errMsg.trim()
    : (error && typeof error.message === 'string' ? error.message.trim() : '')
  if (/privacy|scope|authorize|permission/i.test(detail)) {
    return '微信剪贴板授权没有生效（scope），请长按下方邀请码手动复制'
  }
  return detail
    ? `系统复制暂时不可用，请长按下方邀请码手动复制（${detail.slice(0, 60)}）`
    : '系统复制暂时不可用，请长按下方邀请码手动复制'
}

function copyText(value) {
  return new Promise((resolve, reject) => {
    if (typeof wx.setClipboardData !== 'function') {
      reject(new Error('当前微信版本不支持系统复制'))
      return
    }
    try {
      wx.setClipboardData({ data: String(value), success: resolve, fail: reject })
    } catch (error) {
      reject(error)
    }
  })
}

function loadRecoveryFor(error) {
  const code = error && error.code
  return ['UNAUTHORIZED', 'PROFILE_REQUIRED', 'IDENTITY_NOTICE_REQUIRED'].includes(code)
    ? 'onboarding'
    : 'retry'
}

Page({
  onShareAppMessage(event) {
    const inviteReady = Boolean(event && event.from === 'button' && this.data.inviteToken && this.data.sharePath && this.data.sharePath !== HOME_PATH)
    return {
      ...getShareMessage(),
      title: inviteReady ? '胡巴家长们｜邀请你加入我们的空间' : '胡巴家长们｜体验小程序（此卡片不含邀请码）',
      path: inviteReady ? this.data.sharePath : HOME_PATH,
    }
  },

  data: {
    loading: true,
    busy: false,
    error: '',
    loadError: '',
    loadRecovery: '',
    notice: '',
    state: '',
    displayName: '',
    avatarGlyph: '',
    spaceName: '',
    anniversaryDate: '',
    partnerName: '',
    partnerStatus: '',
    canLeaveSpace: false,
    inviteToken: '',
    inviteExpiryText: '',
    copyState: 'idle',
    copyError: '',
    today: '',
    sharePath: HOME_PATH,
    previewMode: false,
    deletionView: { mode: 'normal', title: '', message: '', primary: '', secondary: '' },
    spaceLocked: false,
    deletionOperationId: '',
    accountRegistered: false,
  },

  onLoad(options) {
    const app = getApp()
    const inviteToken = normalizeInviteToken(options && options.inviteToken)
    this.setData({
      today: todayText(),
      previewMode: Boolean(app && app.previewMode),
      inviteToken,
      inviteExpiryText: inviteToken ? formatExpiry(options && options.expiresAt) : '',
      sharePath: inviteToken ? `/pages/Invite/index?inviteToken=${encodeURIComponent(inviteToken)}` : HOME_PATH,
      notice: inviteToken ? '空间已创建，可以复制邀请码发给伴侣' : '',
    })
    return this.loadSpace()
  },

  onShow() {
    if (!this._hasShown) {
      this._hasShown = true
      return
    }
    return this.loadSpace()
  },

  async loadSpace() {
    this.setData({ loading: true, error: '', loadError: '', loadRecovery: '', state: '' })
    try {
      const bootstrap = await getApp().api('getBootstrap')
      if (!bootstrap || typeof bootstrap !== 'object' || Array.isArray(bootstrap)) {
        throw new Error('暂时读不到空间信息')
      }
      const space = bootstrap.space || null
      const partner = bootstrap.partner || null
      const user = bootstrap.user || {}
      this.setData({
        loading: false,
        state: typeof bootstrap.state === 'string' ? bootstrap.state : '',
        accountRegistered: user.registered === true,
        displayName: typeof user.displayName === 'string' ? user.displayName : '',
        avatarGlyph: avatarView(user.avatarKey).glyph,
        spaceName: space && typeof space.name === 'string' ? space.name : '',
        anniversaryDate: space && typeof space.anniversaryDate === 'string' ? space.anniversaryDate : '',
        partnerName: partner && partner.displayName ? partner.displayName : '还没有伴侣',
        partnerStatus: partner ? '已配对' : '未配对',
        canLeaveSpace: Boolean(partner),
        ...(partner ? {
          inviteToken: '', inviteExpiryText: '', sharePath: HOME_PATH,
          copyState: 'idle', copyError: '',
        } : {}),
        deletionView: deletionView(bootstrap),
        deletionOperationId: (bootstrap.space && bootstrap.space.deletion && bootstrap.space.deletion.operationId) || '',
        spaceLocked: bootstrap.state === 'deleting' || bootstrap.state === 'frozen',
        loadError: '',
        loadRecovery: '',
      })
    } catch (error) {
      this.setData({
        loading: false,
        state: '',
        loadError: (error && error.message) || '暂时读不到空间信息',
        loadRecovery: loadRecoveryFor(error),
      })
    }
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

  async copyInvite() {
    if (this.data.copyState === 'copying') return
    const token = normalizeInviteToken(this.data.inviteToken)
    if (!token) {
      this.setData({ error: '请先生成一条邀请' })
      wx.showToast({ title: '请先生成邀请', icon: 'none' })
      return
    }
    this.setData({ copyState: 'copying', copyError: '', error: '' })
    try {
      await copyText(token)
      // setClipboardData 成功后微信会显示原生“内容已复制”，这里不叠加第二个 Toast。
      this.setData({
        copyState: 'success',
        notice: '邀请码已复制，直接通过普通微信消息发给伴侣即可',
      })
    } catch (error) {
      this.setData({
        copyState: 'manual',
        copyError: clipboardFailureMessage(error),
        notice: '',
      })
    }
  },

  async saveSpace() {
    if (this.data.busy) return
    const name = validateSpaceName(this.data.spaceName)
    if (!name.ok) {
      this.setData({ error: name.error })
      return
    }
    const anniversary = validateAnniversary(this.data.anniversaryDate)
    if (!anniversary.ok) {
      this.setData({ error: anniversary.error })
      return
    }
    this.setData({ busy: true, error: '' })
    try {
      await getApp().api('updateSpace', { name: name.value, anniversaryDate: anniversary.value })
      this.setData({ notice: '空间信息已保存', spaceName: name.value, anniversaryDate: anniversary.value })
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (error) {
      this.setData({ error: (error && error.message) || '保存失败，请稍后重试' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async regenerateInvite() {
    if (this.data.busy) return
    if (this.data.partnerStatus === '已配对') {
      this.setData({ error: '空间已有两名成员，无需再生成邀请' })
      return
    }
    const agreed = await confirmDialog({
      title: '重新生成邀请',
      content: '旧的邀请会立刻失效。新的邀请 48 小时内有效，也只能使用一次。',
      confirmText: '重新生成',
    })
    if (!agreed) return
    this.setData({ busy: true, error: '' })
    try {
      const result = await getApp().api('regenerateInvite')
      const token = normalizeInviteToken(result && result.inviteToken)
      this.setData({
        inviteToken: token,
        inviteExpiryText: formatExpiry(result && result.expiresAt),
        sharePath: token ? `/pages/Invite/index?inviteToken=${encodeURIComponent(token)}` : HOME_PATH,
        copyState: 'idle',
        copyError: '',
        notice: token ? '新的邀请已生成，点下面的按钮发给伴侣' : '',
      })
      wx.showToast({ title: '新的邀请已生成', icon: 'success' })
    } catch (error) {
      this.setData({ error: (error && error.message) || '生成失败，请稍后重试' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async unpair() {
    if (this.data.busy) return
    if (!this.data.canLeaveSpace) {
      this.setData({ error: '你是空间最后一名成员，请通过注销共同空间处理原空间。两次确认后会开始清理数据。' })
      return
    }
    const agreed = await confirmDialog({
      title: '解除这次配对',
      content: '解除后你会离开这个空间，对方空间里的内容会保留。两个人之后都看不到彼此的共享内容。',
      confirmText: '解除配对',
      confirmColor: '#c0405f',
    })
    if (!agreed) return
    this.setData({ busy: true, error: '' })
    try {
      await getApp().api('unpair')
      clearXiaoBaSession(wx)
      wx.showToast({ title: '已解除配对', icon: 'success' })
      await this.loadSpace()
    } catch (error) {
      this.setData({ error: (error && error.message) || '解除失败，请稍后重试' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async requestDeletion() {
    if (this.data.busy) return
    const first = await confirmDialog({
      title: '申请删除空间数据',
      content: '删除会清掉两个人的任务、积分、记录和照片，自己无法恢复。',
      confirmText: '我要申请',
      confirmColor: '#c0405f',
    })
    if (!first) return
    const second = await confirmDialog({
      title: '再确认一次',
      content: this.data.partnerStatus === '已配对'
        ? '提交后等待对方确认；对方同意后会立即开始清理共同数据。'
        : '当前只有你一名成员，确认后会立即开始清理空间数据，不能恢复。',
      confirmText: '确定提交',
      confirmColor: '#c0405f',
    })
    if (!second) return
    this.setData({ busy: true, error: '' })
    let purgeOperationId = ''
    try {
      const result = await getApp().api('requestSpaceDeletion')
      if (result && result.phase === 'awaiting_partner') {
        this.setData({ notice: '注销申请已提交，正在等待对方确认。' })
        wx.showToast({ title: '申请已提交', icon: 'success' })
        await this.loadSpace()
      } else if (result && result.operationId) {
        purgeOperationId = result.operationId
      } else {
        throw new Error('注销状态不完整，请刷新后重试')
      }
    } catch (error) {
      const message = (error && error.message) || '提交失败，请稍后重试'
      await this.loadSpace()
      this.setData({ error: this.data.deletionView.mode !== 'normal'
        ? '云端可能已保存注销申请，请按当前状态继续处理，不要重复提交。'
        : message })
    } finally {
      this.setData({ busy: false })
    }
    if (purgeOperationId) await this.beginPurge(purgeOperationId)
  },

  async deleteAccount() {
    if (this.data.busy || this.data.state !== 'unpaired' || !this.data.accountRegistered) return
    const first = await confirmDialog({
      title: '注销个人账号',
      content: '当前账号不在任何空间。注销会删除昵称和头像设置；以前共同空间的内容可能仍由对方保留。',
      confirmText: '继续注销',
      confirmColor: '#c0405f',
    })
    if (!first) return
    const second = await confirmDialog({
      title: '最后确认',
      content: '注销完成后，下次打开会作为新用户重新开始。此操作不能撤销。',
      confirmText: '确认注销',
      confirmColor: '#c0405f',
    })
    if (!second) return
    this.setData({ busy: true, error: '' })
    try {
      await getApp().api('deleteAccount')
      clearXiaoBaSession(wx)
      const app = getApp()
      if (app && app.globalData) {
        app.globalData.currentUser = null
        app.globalData.partner = null
        app.globalData.space = null
        app.globalData.spaceState = ''
      }
      if (app) app.bootstrap = null
      wx.showToast({ title: '账号已注销', icon: 'success' })
      wx.reLaunch({ url: '/pages/Welcome/index' })
    } catch (error) {
      this.setData({ error: (error && error.message) || '注销失败，请稍后重试' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async lifecycleAction(action, notice) {
    if (this.data.busy) return
    this.setData({ busy: true, error: '' })
    try {
      await getApp().api(action, { operationId: this.data.deletionOperationId })
      this.setData({ notice })
      await this.loadSpace()
    } catch (error) {
      const message = (error && error.message) || '操作失败，请稍后重试'
      await this.loadSpace()
      this.setData(this.data.deletionView.mode === 'normal'
        ? { error: '', notice }
        : { error: message })
    } finally {
      this.setData({ busy: false })
    }
  },

  async approveDeletion() {
    if (this.data.busy) return
    const first = await confirmDialog({
      title: '同意注销共同空间',
      content: '对方申请删除共同空间。继续后任务、积分、记录和照片会被清理。',
      confirmText: '继续确认',
      confirmColor: '#c0405f',
    })
    if (!first) return
    const second = await confirmDialog({
      title: '最后确认',
      content: '同意后将立即开始清理双方数据，开始后不能撤销。',
      confirmText: '确认注销',
      confirmColor: '#c0405f',
    })
    if (!second) return
    this.setData({ busy: true, error: '' })
    let purgeOperationId = ''
    try {
      const result = await getApp().api('approveSpaceDeletion', { operationId: this.data.deletionOperationId })
      purgeOperationId = result && result.operationId
      if (!purgeOperationId) throw new Error('注销状态不完整，请刷新后重试')
    } catch (error) {
      const message = (error && error.message) || '同意失败，请稍后重试'
      await this.loadSpace()
      this.setData({ error: this.data.deletionView.mode === 'ready-to-purge'
        ? '云端已记录同意，但清理尚未开始。请在当前页继续处理。'
        : message })
    } finally {
      this.setData({ busy: false })
    }
    if (purgeOperationId) await this.beginPurge(purgeOperationId)
  },

  async rejectDeletion() {
    const agreed = await confirmDialog({ title: '拒绝注销申请', content: '拒绝后空间继续正常使用。', confirmText: '拒绝申请' })
    if (agreed) await this.lifecycleAction('rejectSpaceDeletion', '已拒绝注销申请，空间可以继续使用。')
  },

  async cancelDeletion() {
    const agreed = await confirmDialog({ title: '撤销注销申请', content: '撤销后空间会恢复正常使用。', confirmText: '撤销申请' })
    if (agreed) await this.lifecycleAction('cancelSpaceDeletion', '注销申请已撤销，空间已恢复。')
  },

  async restoreLegacyDeletion() {
    const agreed = await confirmDialog({ title: '恢复空间', content: '旧版申请没有删除任何数据，恢复后可以继续正常使用。', confirmText: '恢复使用' })
    if (agreed) await this.lifecycleAction('restoreLegacyDeletingSpace', '旧版申请已撤销，空间已恢复。')
  },

  async continuePurge() {
    if (this.data.busy) return
    this.setData({ busy: true, error: '', notice: '正在分批清理，请不要关闭页面…' })
    try {
      let result = { phase: 'purging' }
      for (let attempt = 0; attempt < 4 && result.phase === 'purging'; attempt += 1) {
        result = await getApp().api('continueSpacePurge', { operationId: this.data.deletionOperationId })
      }
      if (result.phase === 'complete') {
        clearXiaoBaSession(wx)
        wx.showToast({ title: '空间已删除', icon: 'success' })
        if (typeof wx.switchTab === 'function') wx.switchTab({ url: HOME_PATH })
        return
      }
      this.setData({ notice: '已保存清理进度，可以继续处理。' })
      await this.loadSpace()
    } catch (error) {
      this.setData({
        error: (error && error.message) || '清理暂时中断，请点击继续重试',
        notice: '已完成的清理进度已保存。请稍后点击“继续安全清理”；不会从头重复删除。',
      })
    } finally {
      this.setData({ busy: false })
    }
  },

  async beginPurge(operationId) {
    this.setData({ busy: true, error: '', deletionOperationId: operationId })
    try {
      await getApp().api('startSpacePurge', { operationId })
    } catch (error) {
      const message = (error && error.message) || '暂时不能开始清理，请刷新后重试'
      this.setData({ busy: false })
      await this.loadSpace()
      this.setData({ error: message })
      return
    }
    this.setData({ busy: false })
    await this.continuePurge()
  },

  async finalizeDeletion() {
    if (this.data.busy) return
    const first = await confirmDialog({
      title: '最终删除共同空间',
      content: '旧申请无需继续等待。现在开始会清理任务、积分、记录、照片和邀请。',
      confirmText: '继续',
      confirmColor: '#c0405f',
    })
    if (!first) return
    const second = await confirmDialog({
      title: '最后确认',
      content: '删除开始后不可撤销，也无法恢复共同数据。',
      confirmText: '确认删除',
      confirmColor: '#c0405f',
    })
    if (second) await this.beginPurge(this.data.deletionOperationId)
  },

  goSetup() {
    if (typeof wx.navigateTo === 'function') wx.navigateTo({ url: '/pages/Setup/index' })
  },
  goOnboarding() {
    if (typeof wx.navigateTo === 'function') wx.navigateTo({ url: '/pages/Setup/index' })
  },
  retryLoad() {
    return this.loadSpace()
  },
  refreshStatus() {
    return this.loadSpace()
  },
  openHelp() {
    if (typeof wx.navigateTo === 'function') wx.navigateTo({ url: '/pages/Help/index' })
  },
})
