const { loadList } = require('../../utils/list-feedback.js')
const { getShareMessage } = require('../../utils/share.js')
const { pageAppearance, refreshPageAppearance } = require('../../utils/appearance.js')

Page({
  onShareAppMessage() {
    return getShareMessage()
  },

  // 保存商品的 _id 和详细信息
  data: {
    _id: '',
    loading: true,
    loaded: false,
    loadError: '',
    item: null,
    dateStr: '',
    timeStr: '',
    creditPercent: 0,
    from: '',
    to: '',
    maxCredit: getApp().globalData.maxCredit,
    list: getApp().globalData.collectionMarketList,
    appearance: pageAppearance(getApp()),
  },

  onLoad(options) {
    // 保存上一页传来的 _id 字段，用于查询商品
    if (options && options.id !== undefined) {
      this.setData({
        _id: options.id
      })
    }
  },
  
  getDate(dateStr){
    const milliseconds = Date.parse(dateStr)
    const date = new Date()
    date.setTime(milliseconds)
    return date
  },


  async onShow() {
    const app = getApp()
    if (!app.ensureConfigured()) {
      this.setData({ loading: false, loadError: '请先返回首页完成空间设置' })
      return
    }
    await refreshPageAppearance(this, app)
    return this.loadDetail()
  },

  loadDetail() {
    if (!this.data._id) {
      this.setData({ loading: false, loadError: '没有找到这条记录，请返回列表重新打开' })
      return
    }
    return loadList(this, () => getApp().api('getById', { list: this.data.list, id: this.data._id }), data => {
      if (!data || !data._id) throw new Error('Record unavailable')
      const date = this.getDate(data.date)
      const valid = !Number.isNaN(date.getTime())
      const app = getApp()
      const mine = app.isMine(data._openid)
      this.setData({
        item: data,
        dateStr: valid ? date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日' : '日期未记录',
        timeStr: valid ? String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0') : '',
        creditPercent: Math.min(100, Math.max(0, data.credit / app.globalData.maxCredit * 100)),
        from: mine ? app.myName() : app.partnerName(),
        to: mine ? app.partnerName() : app.myName(),
      })
    }, '详情')
  },
})
