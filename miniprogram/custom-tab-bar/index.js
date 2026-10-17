Component({
  data: {
    selected: 0,
    hidden: false,
    list: [
      {
        pagePath: '/pages/MainPage/index',
        text: '首页',
        iconPath: '/images/TabBar/HomeIconGrey.png',
        selectedIconPath: '/images/TabBar/HomeIconColor.png',
      },
      {
        pagePath: '/pages/Mission/index',
        text: '任务',
        iconPath: '/images/TabBar/MissionIconGrey.png',
        selectedIconPath: '/images/TabBar/MissionIconColor.png',
      },
      {
        pagePath: '/pages/Market/index',
        text: '商城',
        iconPath: '/images/TabBar/MarketIconGrey.png',
        selectedIconPath: '/images/TabBar/MarketIconColor.png',
      },
      {
        pagePath: '/pages/Account/index',
        text: '仓库',
        iconPath: '/images/TabBar/AccountIconGrey.png',
        selectedIconPath: '/images/TabBar/AccountIconColor.png',
      },
      {
        pagePath: '/pages/Records/index',
        text: '记录',
        iconPath: '/images/TabBar/RecordsIconGrey.png',
        selectedIconPath: '/images/TabBar/RecordsIconColor.png',
      },
    ],
  },

  methods: {
    switchTab(event) {
      const { index, path } = event.currentTarget.dataset
      if (Number(index) === this.data.selected || this._switching) return
      const previous = this.data.selected
      this._switching = true
      wx.switchTab({
        url: path,
        success: () => this.setData({ selected: Number(index) }),
        fail: () => {
          this.setData({ selected: previous })
          wx.showToast({ title: '页面没有打开，请再试一次', icon: 'none' })
        },
        complete: () => { this._switching = false },
      })
    },
  },
})
