const { getShareMessage } = require('../../utils/share.js')
const { validatePickedImage } = require('../../utils/space.js')

const CATEGORIES = [
  { key: 'meat', label: '荤菜', icon: '🥩' },
  { key: 'vegetable', label: '素菜', icon: '🥬' },
  { key: 'soup', label: '汤羹', icon: '🥣' },
  { key: 'staple', label: '主食', icon: '🍚' },
  { key: 'dessert', label: '甜品', icon: '🍰' },
]

Page({
  onShareAppMessage() {
    return getShareMessage()
  },

  data: {
    title: '',
    desc: '',
    minutes: '30',
    category: 'meat',
    categories: CATEGORIES,
    imageTempPath: '',
    saving: false,
  },

  setTitle(event) { this.setData({ title: event.detail.value }) },
  setDesc(event) { this.setData({ desc: event.detail.value }) },
  setMinutes(event) { this.setData({ minutes: event.detail.value }) },
  selectCategory(event) { if (!this.data.saving) this.setData({ category: event.currentTarget.dataset.category }) },

  chooseImage() {
    if (this.data.saving) return
    if (!getApp().ensureWritable()) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: result => {
        if (this.data.saving) return
        const file = result.tempFiles && result.tempFiles[0]
        if (!file || !file.tempFilePath) return
        const check = validatePickedImage(file)
        if (!check.ok) {
          wx.showToast({ title: check.error, icon: 'none' })
          return
        }
        this.setData({ imageTempPath: file.tempFilePath })
      },
    })
  },

  removeImage() {
    if (this.data.saving) return
    this.setData({ imageTempPath: '' })
  },

  async saveDish() {
    if (this.data.saving) return
    const title = this.data.title.trim()
    const desc = this.data.desc.trim()
    const minutes = Number(this.data.minutes)
    if (!title || title.length > 20) {
      wx.showToast({ title: '菜名请填写 1 到 20 个字', icon: 'none' })
      return
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 300) {
      wx.showToast({ title: '制作时间请填 1 到 300 分钟', icon: 'none' })
      return
    }
    getApp().renewPartnerReminderSilently()
    this.setData({ saving: true })
    wx.showLoading({ title: '把菜放进菜单' })
    let uploadedFileId = ''
    try {
      if (this.data.imageTempPath) {
        const cloud = getApp().cloud()
        const cloudPath = await getApp().spaceUploadPath('dishes')
        const upload = await cloud.uploadFile({
          cloudPath,
          filePath: this.data.imageTempPath,
        })
        uploadedFileId = upload.fileID
        await getApp().api('trackSpaceFile', { fileId: uploadedFileId })
      }
      await getApp().api('createDish', {
        title,
        desc,
        category: this.data.category,
        minutes,
        imageFileId: uploadedFileId,
      })
      wx.showToast({ title: '菜品已添加', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (error) {
      if (uploadedFileId) {
        try {
          const cloud = getApp().cloud()
          await cloud.deleteFile({ fileList: [uploadedFileId] })
        } catch (cleanupError) {
          console.warn('uploaded dish image cleanup failed')
        }
      }
      wx.showToast({ title: error.message || '菜品添加失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
      wx.hideLoading()
    }
  },
})
