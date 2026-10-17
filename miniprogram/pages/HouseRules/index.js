const { getShareMessage } = require('../../utils/share.js')
const { pageAppearance, refreshPageAppearance } = require('../../utils/appearance.js')

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

Page({
  onShareAppMessage() {
    return getShareMessage()
  },

  data: {
    currentUser: '',
    currentOpenid: '',
    content: '',
    rules: [],
    saving: false,
    loading: true,
    loadError: '',
    appearance: pageAppearance(getApp()),
  },

  async onShow() {
    const app = getApp()
    if (!app.ensureConfigured()) {
      wx.showToast({ title: '请先回到首页完成空间设置', icon: 'none' })
      return
    }
    await refreshPageAppearance(this, app)
    this.setData({ currentUser: app.myName() })
    await this.loadRules()
  },

  presentRules(items, callerOpenid) {
    const app = getApp()
    return items.map(item => ({
      ...item,
      author: app.nameOf(item._openid),
      dateText: formatDate(item.date),
      canDelete: item._openid === callerOpenid,
    }))
  },

  async loadRules() {
    const app = getApp()
    if (this._rulesLoading) return
    this._rulesLoading = true
    this.setData({ loading: true, loadError: '' })
    try {
      const result = await app.api('getHouseRules')
      const callerOpenid = result.callerOpenid
      this.setData({
        currentOpenid: callerOpenid,
        currentUser: app.nameOf(callerOpenid),
        rules: this.presentRules(result.items || [], callerOpenid),
      })
    } catch (error) {
      this.setData({ loadError: '暂时没能读取心得，请重试' })
    } finally {
      this._rulesLoading = false
      this.setData({ loading: false })
    }
  },

  onContentInput(event) {
    this.setData({ content: event.detail.value })
  },

  async saveRule() {
    if (this.data.saving) return
    const app = getApp()
    const content = this.data.content.trim()
    if (!content) {
      wx.showToast({ title: '先写一点心得吧', icon: 'none' })
      return
    }
    app.renewPartnerReminderSilently()
    this.setData({ saving: true })
    try {
      await app.api('createHouseRule', { content })
      this.setData({ content: '' })
      await this.loadRules()
      wx.showToast({ title: '已经记下来啦', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  deleteRule(event) {
    const app = getApp()
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: '删除这条心得？',
      content: '删除后不能恢复。',
      success: async result => {
        if (!result.confirm) return
        try {
          await app.api('deleteHouseRule', { id })
          await this.loadRules()
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: error.message || '删除失败，请重试', icon: 'none' })
        }
      },
    })
  },
})
