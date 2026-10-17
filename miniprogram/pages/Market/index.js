const { loadList, runListAction, updateRow } = require('../../utils/list-feedback.js')
const { getShareMessage } = require('../../utils/share.js')
const { pageAppearance, refreshPageAppearance } = require('../../utils/appearance.js')

Page({
  onShareAppMessage() {
    return getShareMessage()
  },

  data: {
    loading: true,
    loaded: false,
    loadError: '',
    actionBusy: false,
    screenWidth: 1000,
    screenHeight: 1000,

    search: "",
    credit: 0,
    user: "",
    partner: "",
    profileAvatar: "../../images/brand/mascot-a.png",
    appearance: pageAppearance(getApp()),

    allItems: [], //所有商品
    unboughtItems: [], //上架商品
    boughtItems: [], //下架商品

    slideButtons: [
      {extClass: 'buyBtn', text: '兑换', src: "Images/icon_buy.svg"},
      {extClass: 'starBtn', text: '星标', src: "Images/icon_star.svg"},
      {extClass: 'removeBtn', text: '删除', src: 'Images/icon_del.svg'}
    ],
  },


  async onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 2 })
    const app = getApp()
    if (!app.ensureConfigured()) {
      this.setData({ loading: false, loadError: '请先返回首页完成空间设置' })
      return
    }
    await refreshPageAppearance(this, app)
    return this.loadData()
  },

  loadData() {
    return loadList(this, async () => {
      await this.loadProfile()
      return getApp().api('getList', { list: getApp().globalData.collectionMarketList })
    }, rows => {
      if (!Array.isArray(rows)) throw new Error('Invalid list response')
      this.setData({ allItems: rows })

      this.filterItem()
    }, '商品')
  },

  clearSearch() {
    this.setData({ search: '' })
    this.filterItem()
  },

  onPullDownRefresh() {
    return this.loadData().finally(() => wx.stopPullDownRefresh())
  },

  async loadProfile(){
    const app = getApp()
    const session = await app.api('getSession')
    this.setData({
      credit: session.credit,
      user: app.myName(),
      partner: app.partnerName(),
    })
  },

  //获取页面大小
  async getScreenSize(){
    wx.getSystemInfo({
      success: (res) => {
        this.setData({
          screenWidth: res.windowWidth,
          screenHeight: res.windowHeight
        })
      }
    })
  },

  //转到商品详情
  async toDetailPage(element, isUpper) {
    const itemIndex = element.currentTarget.dataset.index
    const item = isUpper ? this.data.unboughtItems[itemIndex] : this.data.boughtItems[itemIndex]
    wx.navigateTo({url: '../MarketDetail/index?id=' + item._id})
  },
  //转到商品详情[上]
  async toDetailPageUpper(element) {
    this.toDetailPage(element, true)
  },
  //转到商品详情[下]
  async toDetailPageLower(element) {
    this.toDetailPage(element, false)
  },
  //转到添加商品
  async toAddPage() {
    wx.navigateTo({url: '../MarketAdd/index'})
  },

  //设置搜索
  onSearch(element){
    this.setData({
      search: element.detail.value
    })

    this.filterItem()
  },

  //将商品划分为：未兑换，已兑换；同时补上「这条是不是我上架的」
  filterItem(){
    const app = getApp()
    const decorate = item => ({
      ...item,
      mine: app.isMine(item._openid),
      ownerName: app.nameOf(item._openid),
    })
    let itemList = []
    if(this.data.search != ""){
      for(let i in this.data.allItems){
        if(String(this.data.allItems[i].title || '').includes(this.data.search)){
          itemList.push(this.data.allItems[i])
        }
      }
    }else{
      itemList = this.data.allItems
    }

    this.setData({
      unboughtItems: itemList.filter(item => item.available === true).map(decorate),
      boughtItems: itemList.filter(item => item.available === false).map(decorate),
    })
  },

  //响应左划按钮事件[上]
  async slideButtonTapUpper(element) {
    return this.slideButtonTap(element, true)
  },

  //响应左划按钮事件[下]
  async slideButtonTapLower(element) {
    return this.slideButtonTap(element, false)
  },


  async slideButtonTap(element, isUpper) {
    const action = Number(element.detail.index)
    const item = this.data[isUpper ? 'unboughtItems' : 'boughtItems'][element.currentTarget.dataset.index]
    if (!item || this.data.actionBusy) return
    if (action === 0) {
      if (isUpper) return this.buyItem(element)
      wx.showToast({ title: '商品已经兑换', icon: 'none' })
      return
    }
    if (!getApp().isMine(item._openid)) {
      wx.showToast({ title: '只能管理自己的商品', icon: 'none' })
      return
    }
    if (action !== 1 && action !== 2) return
    return runListAction(this, async () => {
      if (action === 1) {
        await getApp().api('setStar', { id: item._id, list: getApp().globalData.collectionMarketList, value: !item.star })
        this.setData({ allItems: updateRow(this.data.allItems, item._id, { star: !item.star }) })
      } else {
        await getApp().api('deleteElement', { id: item._id, list: getApp().globalData.collectionMarketList })
        this.setData({ allItems: this.data.allItems.filter(row => row._id !== item._id) })
      }

      this.filterItem()
    }, {
      success: action === 2 ? '已删除' : item.star ? '已取消星标' : '已加星标',
      confirm: action === 2 ? { title: '删除这条商品？', content: '“' + item.title + '”删除后不能恢复。' } : null,
    })
  },

  async buyItem(element) {
    const item = this.data.unboughtItems[element.currentTarget.dataset.index]
    if (!item) return
    return runListAction(this, async () => {
      getApp().renewPartnerReminderSilently()
      const result = await getApp().api('buyItem', { id: item._id })
      this.setData({ allItems: updateRow(this.data.allItems, item._id, { available: false }), credit: result.credit })

      this.filterItem()
    }, { success: '兑换成功' })
  },

})
