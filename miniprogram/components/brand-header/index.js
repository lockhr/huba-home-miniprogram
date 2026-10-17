Component({
  data: {
    statusBarHeight: 24,
    headerHeight: 108,
    copyMaxWidth: 260,
    mascotRight: 12,
  },

  lifetimes: {
    attached() {
      try {
        const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
        const statusBarHeight = windowInfo.statusBarHeight || 24
        const headerHeight = menu ? Math.max(menu.bottom + 30, statusBarHeight + 76) : statusBarHeight + 76
        const copyMaxWidth = menu ? Math.max(menu.left - 24, 180) : windowInfo.windowWidth - 48
        const mascotRight = menu ? Math.max(windowInfo.windowWidth - menu.left + 8, 12) : 12
        this.setData({ statusBarHeight, headerHeight, copyMaxWidth, mascotRight })
      } catch (error) {
        this.setData({ statusBarHeight: 24, headerHeight: 108, copyMaxWidth: 260, mascotRight: 12 })
      }
    },
  },
})
