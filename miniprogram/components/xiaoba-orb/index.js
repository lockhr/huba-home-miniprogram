const { canShowXiaoBa } = require('../../utils/space.js')

Component({
  data: { visible: false },
  lifetimes: {
    attached() { this.refreshVisibility() },
  },
  pageLifetimes: {
    show() { this.refreshVisibility() },
  },
  methods: {
    async refreshVisibility() {
      const app = getApp()
      let bootstrap = null
      try { bootstrap = app.loadBootstrap ? await app.loadBootstrap() : app.bootstrap } catch (error) { bootstrap = null }
      this.setData({ visible: canShowXiaoBa(bootstrap, app.previewMode) })
    },
    openXiaoBa() {
      if (!this.data.visible) return
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      if (current && current.route === 'pages/XiaoBa/index') return
      wx.navigateTo({ url: '/pages/XiaoBa/index' })
    },
  },
})
