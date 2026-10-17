const { loadList, runListAction, updateRow } = require('../../utils/list-feedback.js')
const { getShareMessage } = require('../../utils/share.js')
const { buildMonth, filterMissionsForDay, isValidPlanDate, todayText } = require('../../utils/mission-calendar.js')
const { pageAppearance, refreshPageAppearance } = require('../../utils/appearance.js')

const now = new Date()

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
    appearance: pageAppearance(getApp()),

    search: "",

    allMissions: [],
    unfinishedMissions: [],
    finishedMissions: [],
    calendarMode: 'all',
    selectedDate: todayText(now),
    calendarYear: now.getFullYear(),
    calendarMonth: now.getMonth() + 1,
    calendarCells: [],
    calendarTitle: '',

    slideButtons: [
      {extClass: 'markBtn', text: '完成', src: "Images/icon_mark.svg"},
      {extClass: 'starBtn', text: '星标', src: "Images/icon_star.svg"},
      {extClass: 'removeBtn', text: '删除', src: 'Images/icon_del.svg'}
    ],
  },


  async onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 1 })
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

      return getApp().api('getList', { list: getApp().globalData.collectionMissionList })
    }, rows => {
      if (!Array.isArray(rows)) throw new Error('Invalid list response')
      this.setData({ allMissions: rows })
      this.refreshCalendar()
      this.filterMission()
    }, '任务')
  },

  clearSearch() {
    this.setData({ search: '' })
    this.filterMission()
  },

  onPullDownRefresh() {
    return this.loadData().finally(() => wx.stopPullDownRefresh())
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

  //转到任务详情
  async toDetailPage(element, isUpper) {
    const missionIndex = element.currentTarget.dataset.index
    const mission = isUpper ? this.data.unfinishedMissions[missionIndex] : this.data.finishedMissions[missionIndex]
    wx.navigateTo({url: '../MissionDetail/index?id=' + mission._id})
  },
  //转到任务详情[上]
  async toDetailPageUpper(element) {
    this.toDetailPage(element, true)
  },
  //转到任务详情[下]
  async toDetailPageLower(element) {
    this.toDetailPage(element, false)
  },
  //转到添加任务
  async toAddPage() {
    wx.navigateTo({url: '../MissionAdd/index'})
  },

  //设置搜索
  onSearch(element){
    this.setData({
      search: element.detail.value
    })

    this.filterMission()
  },

  refreshCalendar() {
    const { calendarYear, calendarMonth, allMissions } = this.data
    this.setData({
      calendarTitle: `${calendarYear} 年 ${calendarMonth} 月`,
      calendarCells: buildMonth(calendarYear, calendarMonth, allMissions),
    })
  },

  changeMonth(event) {
    const offset = Number(event.currentTarget.dataset.offset)
    if (offset !== -1 && offset !== 1) return
    const date = new Date(Date.UTC(this.data.calendarYear, this.data.calendarMonth - 1 + offset, 1))
    this.setData({ calendarYear: date.getUTCFullYear(), calendarMonth: date.getUTCMonth() + 1 })
    this.refreshCalendar()
  },

  selectCalendarDay(event) {
    const date = event.currentTarget.dataset.date
    if (!isValidPlanDate(date)) return
    const [year, month] = date.split('-').map(Number)
    this.setData({ calendarMode: 'day', selectedDate: date, calendarYear: year, calendarMonth: month })
    this.refreshCalendar()
    this.filterMission()
  },

  showAllMissions() {
    this.setData({ calendarMode: 'all' })
    this.filterMission()
  },

  //将任务划分为：完成，未完成；同时补上「这条是不是我写的」供界面直接使用
  filterMission(){
    const app = getApp()
    const decorate = item => ({
      ...item,
      mine: app.isMine(item._openid),
      ownerName: app.nameOf(item._openid),
    })
    let missionList = []
    if(this.data.search != ""){
      for(let i in this.data.allMissions){
        if(String(this.data.allMissions[i].title || '').includes(this.data.search)){
          missionList.push(this.data.allMissions[i])
        }
      }
    }else{
      missionList = this.data.allMissions
    }
    if (this.data.calendarMode === 'day') missionList = filterMissionsForDay(missionList, this.data.selectedDate)

    this.setData({
      unfinishedMissions: missionList.filter(item => item.available === true).map(decorate),
      finishedMissions: missionList.filter(item => item.available === false).map(decorate),
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
    const item = this.data[isUpper ? 'unfinishedMissions' : 'finishedMissions'][element.currentTarget.dataset.index]
    if (!item || this.data.actionBusy) return
    if (action === 0) {
      if (isUpper) return this.finishMission(element)
      wx.showToast({ title: '任务已经完成', icon: 'none' })
      return
    }
    if (!getApp().isMine(item._openid)) {
      wx.showToast({ title: '只能管理自己的任务', icon: 'none' })
      return
    }
    if (action !== 1 && action !== 2) return
    return runListAction(this, async () => {
      if (action === 1) {
        await getApp().api('setStar', { id: item._id, list: getApp().globalData.collectionMissionList, value: !item.star })
        this.setData({ allMissions: updateRow(this.data.allMissions, item._id, { star: !item.star }) })
      } else {
        await getApp().api('deleteElement', { id: item._id, list: getApp().globalData.collectionMissionList })
        this.setData({ allMissions: this.data.allMissions.filter(row => row._id !== item._id) })
      }
      this.refreshCalendar()
      this.filterMission()
    }, {
      success: action === 2 ? '已删除' : item.star ? '已取消星标' : '已加星标',
      confirm: action === 2 ? { title: '删除这条任务？', content: '“' + item.title + '”删除后不能恢复。' } : null,
    })
  },

  async finishMission(element) {
    const item = this.data.unfinishedMissions[element.currentTarget.dataset.index]
    if (!item) return
    return runListAction(this, async () => {
      getApp().renewPartnerReminderSilently()
      const result = await getApp().api('completeMission', { id: item._id })
      this.setData({ allMissions: updateRow(this.data.allMissions, item._id, { available: false }) })
      this.refreshCalendar()
      this.filterMission()
    }, { success: '已确认完成' })
  },

  //跳转到空间设置，方便新用户处理未配对状态
  toSpaceSetting() {
    wx.navigateTo({url: '../SpaceSetting/index'})
  },
})
