Component({
  properties: { title: { type: String, value: '胡巴家长们' }, subtitle: String },
  data: { top: 40, height: 108, copyWidth: 220 },
  lifetimes: {
    attached() {
      try {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        const menu = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect()
        const top = (Number(info.statusBarHeight) || 24) + 12
        const width = Number(info.windowWidth) || 375
        this.setData({
          top,
          height: top + 66,
          copyWidth: Math.max(160, Math.min(width - 36, menu && menu.left ? menu.left - 32 : width - 120)),
        })
      } catch (_) { /* Use a usable header until device metrics are available. */ }
    },
  },
})
