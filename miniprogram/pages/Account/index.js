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
        search: "",
        appearance: pageAppearance(getApp()),

        allItems: [],
        unusedItems: [],
        usedItems: [],

        slideButtons: [
            {extClass: 'useBtn', text: '使用', src: "Images/icon_use.svg"},
            {extClass: 'starBtn', text: '星标', src: "Images/icon_star.svg"},
            {extClass: 'removeBtn', text: '删除', src: 'Images/icon_del.svg'}
        ],
    },


  async onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 3 })
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

      return getApp().api('getStorage')
    }, rows => {
      if (!Array.isArray(rows)) throw new Error('Invalid list response')
      this.setData({ allItems: rows })

      this.filterItem()
    }, '物品')
  },

  clearSearch() {
    this.setData({ search: '' })
    this.filterItem()
  },

  onPullDownRefresh() {
    return this.loadData().finally(() => wx.stopPullDownRefresh())
  },

    //转到物品详情
    async toDetailPage(element, isUpper) {
      const itemIndex = element.currentTarget.dataset.index
      const item = isUpper ? this.data.unusedItems[itemIndex] : this.data.usedItems[itemIndex]
      wx.navigateTo({url: '../ItemDetail/index?id=' + item._id})
    },
    //转到物品详情[上]
    async toDetailPageUpper(element) {
      this.toDetailPage(element, true)
    },
    //转到物品详情[下]
    async toDetailPageLower(element) {
      this.toDetailPage(element, false)
    },

    //设置搜索
    onSearch(element){
      this.setData({
        search: element.detail.value
      })

      this.filterItem()
    },

    //将物品划分为：完成，未完成
    filterItem(){
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
        unusedItems: itemList.filter(item => item.available === true),
        usedItems: itemList.filter(item => item.available === false),
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
    const item = this.data[isUpper ? 'unusedItems' : 'usedItems'][element.currentTarget.dataset.index]
    if (!item || this.data.actionBusy) return
    if (action === 0) {
      if (isUpper) return this.useItem(element)
      wx.showToast({ title: '物品已经使用', icon: 'none' })
      return
    }
    if (!getApp().isMine(item._openid)) {
      wx.showToast({ title: '只能管理自己的物品', icon: 'none' })
      return
    }
    if (action !== 1 && action !== 2) return
    return runListAction(this, async () => {
      if (action === 1) {
        await getApp().api('setStar', { id: item._id, list: getApp().globalData.collectionStorageList, value: !item.star })
        this.setData({ allItems: updateRow(this.data.allItems, item._id, { star: !item.star }) })
      } else {
        await getApp().api('deleteElement', { id: item._id, list: getApp().globalData.collectionStorageList })
        this.setData({ allItems: this.data.allItems.filter(row => row._id !== item._id) })
      }

      this.filterItem()
    }, {
      success: action === 2 ? '已删除' : item.star ? '已取消星标' : '已加星标',
      confirm: action === 2 ? { title: '删除这条物品？', content: '“' + item.title + '”删除后不能恢复。' } : null,
    })
  },

  async useItem(element) {
    const item = this.data.unusedItems[element.currentTarget.dataset.index]
    if (!item) return
    return runListAction(this, async () => {
      getApp().renewPartnerReminderSilently()
      const result = await getApp().api('useStorage', { id: item._id })
      this.setData({ allItems: updateRow(this.data.allItems, item._id, { available: false }) })

      this.filterItem()
    }, { success: '已使用' })
  },

})
