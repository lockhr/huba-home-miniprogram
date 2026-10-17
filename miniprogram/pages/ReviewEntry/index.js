const { getShareMessage } = require('../../utils/share.js')

Page({
  onShareAppMessage() {
    return getShareMessage()
  },

  onLoad() {
    const app = getApp()
    if (app && typeof app.enterPreview === 'function') app.enterPreview()
    if (typeof wx.switchTab === 'function') wx.switchTab({ url: '/pages/MainPage/index' })
  },
})
