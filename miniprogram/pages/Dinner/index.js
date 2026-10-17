const { getShareMessage } = require('../../utils/share.js')
const { pageAppearance, refreshPageAppearance } = require('../../utils/appearance.js')

const CATEGORIES = [
  { key: 'all', label: '全部', icon: '🍽️' },
  { key: 'meat', label: '荤菜', icon: '🥩' },
  { key: 'vegetable', label: '素菜', icon: '🥬' },
  { key: 'soup', label: '汤羹', icon: '🥣' },
  { key: 'staple', label: '主食', icon: '🍚' },
  { key: 'dessert', label: '甜品', icon: '🍰' },
]

function categoryOf(key) {
  return CATEGORIES.find(item => item.key === key) || CATEGORIES[0]
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

Page({
  onShareAppMessage() {
    return getShareMessage()
  },

  data: {
    activeTab: 'menu',
    categories: CATEGORIES,
    activeCategory: 'all',
    allDishes: [],
    visibleDishes: [],
    orders: [],
    selectedCount: 0,
    loading: true,
    loadError: '',
    ordering: false,
    appearance: pageAppearance(getApp()),
  },

  async onShow() {
    const app = getApp()
    if (!app.ensureConfigured()) {
      wx.showToast({ title: '请先完成两个人的配置', icon: 'none' })
      return
    }
    await refreshPageAppearance(this, app)
    await this.loadDinner()
  },

  async loadDinner() {
    if (this._dinnerLoading) return
    this._dinnerLoading = true
    this.setData({ loading: true, loadError: '' })
    try {
      const result = await getApp().api('getDinnerData')
      const dishes = (result.dishes || []).map((dish, index) => {
        const category = categoryOf(dish.category)
        return { ...dish, categoryLabel: category.label, categoryIcon: category.icon, tone: index % 3 }
      })
      const orders = (result.orders || []).map(order => ({ ...order, displayDate: formatDate(order.date) }))
      this.setData({ allDishes: dishes, orders, loading: false })
      this.applyFilter()
    } catch (error) {
      this.setData({ loading: false, loadError: '暂时没能读取菜单，请重试' })
    } finally {
      this._dinnerLoading = false
    }
  },

  changeTab(event) {
    this.setData({ activeTab: event.currentTarget.dataset.tab })
  },

  changeCategory(event) {
    this.setData({ activeCategory: event.currentTarget.dataset.category })
    this.applyFilter()
  },

  applyFilter() {
    const { activeCategory, allDishes } = this.data
    const visibleDishes = activeCategory === 'all' ? allDishes : allDishes.filter(item => item.category === activeCategory)
    this.setData({
      visibleDishes,
      selectedCount: allDishes.filter(item => item.selected).length,
    })
  },

  async toggleDish(event) {
    const id = event.currentTarget.dataset.id
    const dish = this.data.allDishes.find(item => item._id === id)
    if (!dish) return
    const selected = !dish.selected
    dish.selected = selected
    this.applyFilter()
    try {
      await getApp().api('toggleDish', { id, selected })
    } catch (error) {
      dish.selected = !selected
      this.applyFilter()
      wx.showToast({ title: error.message || '选择失败', icon: 'none' })
    }
  },

  openAddDish() {
    wx.navigateTo({ url: '/pages/DishAdd/index' })
  },

  deleteDish(event) {
    const id = event.currentTarget.dataset.id
    const dish = this.data.allDishes.find(item => item._id === id)
    if (!dish || !dish.canDelete) {
      wx.showToast({ title: '只能删除自己添加的菜品', icon: 'none' })
      return
    }
    wx.showModal({
      title: `删除“${dish.title}”吗？`,
      content: '删除后需要重新添加',
      confirmColor: '#ff4c8b',
      success: async result => {
        if (!result.confirm) return
        try {
          await getApp().api('deleteDish', { id })
          this.setData({ allDishes: this.data.allDishes.filter(item => item._id !== id) })
          this.applyFilter()
          wx.showToast({ title: '已经删除', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: error.message || '删除失败', icon: 'none' })
        }
      },
    })
  },

  async completeOrder() {
    if (this.data.ordering) return
    if (!this.data.selectedCount) {
      wx.showToast({ title: '请先选择想吃的菜', icon: 'none' })
      return
    }
    getApp().renewPartnerReminderSilently()
    this.setData({ ordering: true })
    wx.showLoading({ title: '正在完成点单', mask: true })
    try {
      await getApp().api('completeDinnerOrder')
      await this.loadDinner()
      this.setData({ activeTab: 'history' })
      wx.showToast({ title: '点单完成', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message || '点单失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ ordering: false })
    }
  },
})
