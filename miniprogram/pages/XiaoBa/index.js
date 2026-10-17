const { getShareMessage } = require('../../utils/share.js')
const { cleanAssistantText } = require('../../utils/ai-text.js')
const { buildXiaoBaContext } = require('../../utils/xiaoba-context.js')
const { canShowXiaoBa } = require('../../utils/space.js')
const { ensureAiConsent } = require('../../utils/ai-consent.js')
const { historyKey } = require('../../utils/xiaoba-storage.js')

const GREETING = '我是小八 ✦\n我可以帮你们安排课程、整理任务、想约会和点菜灵感，也可以认真听你们说话。今天想先做什么？'

function timeText() {
  const date = new Date()
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function message(role, content) {
  const displayContent = role === 'assistant' ? cleanAssistantText(content) : content
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role, content: displayContent, time: timeText() }
}

Page({
  data: {
    messages: [],
    inputText: '',
    sending: false,
    scrollTarget: '',
    keyboardHeight: 0,
    headerTop: 28,
    headerHeight: 90,
    callerOpenid: '',
    quickPrompts: ['我们今天什么时候都有空', '按现有菜单安排今晚', '整理最近任务和愿望', '看看我们今天的状态'],
  },

  async verifyAccess() {
    const app = getApp()
    let bootstrap = null
    try { bootstrap = await app.loadBootstrap() } catch (error) { bootstrap = null }
    const allowed = canShowXiaoBa(bootstrap, app.previewMode)
    const nextHistoryKey = allowed ? historyKey(bootstrap) : ''
    if (this._xiaobaInitialized && nextHistoryKey !== this._historyKey) {
      this._historyKey = nextHistoryKey
      this.setData({ messages: [message('assistant', GREETING)], inputText: '', callerOpenid: '' })
    }
    if (!this._xiaobaInitialized) this._historyKey = nextHistoryKey
    if (!allowed) {
      wx.showToast({ title: '两人完成配对和资料后才能使用小八', icon: 'none' })
      this.goBack()
    }
    return allowed
  },

  onShow() {
    if (this._xiaobaInitialized) this.verifyAccess()
  },

  async onLoad() {
    if (!(await this.verifyAccess())) return
    let windowInfo = {}
    try { windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync() } catch (error) { console.warn('window metrics unavailable') }
    let menu = null
    try { menu = wx.getMenuButtonBoundingClientRect() } catch (error) { console.warn('menu metrics unavailable') }
    const statusBarBottom = Number(windowInfo.statusBarHeight) || 24
    const headerTop = Math.max(statusBarBottom + 12, menu ? menu.bottom + 10 : statusBarBottom + 42)
    const headerHeight = headerTop + 62
    let saved = []
    try {
      const value = this._historyKey ? wx.getStorageSync(this._historyKey) : null
      if (Array.isArray(value)) saved = value.filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').slice(-30)
        .map(item => ({ ...item, content: item.role === 'assistant' ? cleanAssistantText(item.content) : item.content }))
    } catch (error) { console.warn('xiaoba history unavailable') }
    const messages = saved.length ? saved : [message('assistant', GREETING)]
    this._xiaobaInitialized = true
    this.setData({ messages, headerTop, headerHeight }, () => this.scrollToBottom())
  },

  onShareAppMessage() { return getShareMessage() },

  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/MainPage/index' })
  },

  setInput(event) { this.setData({ inputText: event.detail.value }) },

  choosePrompt(event) {
    if (this.data.sending) return
    this.setData({ inputText: event.currentTarget.dataset.prompt }, () => this.sendMessage())
  },

  handleKeyboardHeightChange(event) {
    const keyboardHeight = Number(event.detail && event.detail.height) || 0
    this.setData({ keyboardHeight }, () => this.scrollToBottom())
  },

  handleComposerBlur() {
    if (this.data.keyboardHeight) this.setData({ keyboardHeight: 0 })
  },

  scrollToBottom() {
    const last = this.data.messages[this.data.messages.length - 1]
    if (last) this.setData({ scrollTarget: `message-${last.id}` })
  },

  saveHistory() {
    if (!this._historyKey) return
    try { wx.setStorageSync(this._historyKey, this.data.messages.slice(-30)) } catch (error) { console.warn('xiaoba history save failed') }
  },

  async sendMessage() {
    if (this.data.sending) return
    const content = this.data.inputText.trim()
    if (!content) return
    if (content.length > 500) {
      wx.showToast({ title: '一次最多问小八 500 个字', icon: 'none' })
      return
    }
    if (!(await ensureAiConsent(wx))) {
      wx.showToast({ title: '未同意第三方 AI 处理，本次没有发送', icon: 'none' })
      return
    }
    const nextMessages = [...this.data.messages, message('user', content)]
    this.setData({ messages: nextMessages, inputText: '', sending: true }, () => this.scrollToBottom())
    this.saveHistory()
    try {
      const app = getApp()
      let callerOpenid = this.data.callerOpenid
      if (!callerOpenid) {
        const session = await app.api('getSession')
        callerOpenid = session.openid || session._openid
        this.setData({ callerOpenid })
      }
      const history = nextMessages.slice(-12).map(item => ({ role: item.role, content: item.content }))
      // 身份和课表都由云函数按 spaceId 生成，客户端不再上报 identity。
      const appContext = buildXiaoBaContext({
        currentUser: app.globalData.currentUser,
        partner: app.globalData.partner,
      })
      const result = await app.api('askXiaoBa', { messages: history, appContext, aiConsent: true })
      this.setData({ messages: [...this.data.messages, message('assistant', result.reply)], sending: false }, () => this.scrollToBottom())
      this.saveHistory()
    } catch (error) {
      const fallback = error.code === 'AI_NOT_CONFIGURED'
        ? '我已经住进小程序啦，不过云端密钥还没有配置好。配置完成后再来找我，我就能正式回答了。'
        : '刚才的云朵有点拥挤，我没接住这句话。等一会儿再发一次给我吧。'
      this.setData({ messages: [...this.data.messages, message('assistant', fallback)], sending: false }, () => this.scrollToBottom())
      this.saveHistory()
    }
  },

  clearConversation() {
    wx.showModal({
      title: '清空这段对话？',
      content: '只会清空当前手机里的小八聊天记录。',
      confirmColor: '#ff5d94',
      success: result => {
        if (!result.confirm) return
        const messages = [message('assistant', GREETING)]
        this.setData({ messages, inputText: '' }, () => this.scrollToBottom())
        this.saveHistory()
      },
    })
  },
})
