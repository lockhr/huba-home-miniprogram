const { getShareMessage } = require('../../utils/share.js')
const { validatePickedImage } = require('../../utils/space.js')
const { pageAppearance, pageAppearanceDisplayCustom, refreshPageAppearance } = require('../../utils/appearance.js')

const WISH_ICONS = ['🌅', '🍰', '☔', '📚', '📷', '🎡', '✈️', '💗']

function pad(value) { return String(value).padStart(2, '0') }

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  if (sameDay) return `今天 ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

Page({
  onShareAppMessage() { return getShareMessage() },

  data: {
    activeSection: 'world',
    wishFilter: 'pending',
    posts: [],
    pendingWishes: [],
    completedWishes: [],
    currentOpenid: '',
    loading: true,
    loadError: '',
    showPostEditor: false,
    showWishEditor: false,
    postContent: '',
    postImagePath: '',
    wishTitle: '',
    wishNote: '',
    wishIcon: '💗',
    wishImagePath: '',
    wishIcons: WISH_ICONS,
    saving: false,
    keyboardHeight: 0,
    appearance: pageAppearance(getApp()),
    appearanceDisplayCustom: pageAppearanceDisplayCustom(getApp()),
  },

  async onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 4, hidden: this.data.showPostEditor || this.data.showWishEditor })
    const app = getApp()
    if (!app.ensureConfigured()) {
      wx.showToast({ title: '请先回到首页完成空间设置', icon: 'none' })
      return
    }
    await refreshPageAppearance(this, app)
    await this.loadRecords()
  },

  async onPullDownRefresh() {
    await this.loadRecords()
    wx.stopPullDownRefresh()
  },

  nameFor(openid) {
    return getApp().nameOf(openid)
  },

  presentPost(post, index) {
    return {
      ...post,
      author: this.nameFor(post._openid),
      initial: this.nameFor(post._openid).slice(-1),
      dateText: formatDate(post.date),
      tone: index % 3,
      comments: (post.comments || []).map(comment => ({ ...comment, author: this.nameFor(comment._openid) })),
    }
  },

  presentWish(wish, index) {
    return {
      ...wish,
      author: this.nameFor(wish._openid),
      dateText: formatDate(wish.date),
      completedByName: wish.completedBy ? this.nameFor(wish.completedBy) : '',
      tone: index % 4,
    }
  },

  async loadRecords() {
    if (this._recordsLoading) return
    this._recordsLoading = true
    this.setData({ loading: true, loadError: '' })
    try {
      const result = await getApp().api('getRecords')
      const wishes = (result.wishes || []).map((item, index) => this.presentWish(item, index))
      this.setData({
        currentOpenid: result.callerOpenid,
        posts: (result.posts || []).map((item, index) => this.presentPost(item, index)),
        pendingWishes: wishes.filter(item => !item.completed),
        completedWishes: wishes.filter(item => item.completed),
        loading: false,
      })
    } catch (error) {
      this.setData({ loading: false, loadError: '暂时没能读取记录，请重试' })
    } finally {
      this._recordsLoading = false
    }
  },

  changeSection(event) { this.setData({ activeSection: event.currentTarget.dataset.section }) },
  changeWishFilter(event) { this.setData({ wishFilter: event.currentTarget.dataset.filter }) },
  setTabBarHidden(hidden) {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ hidden })
  },
  onHide() { this.setTabBarHidden(false) },
  onUnload() { this.setTabBarHidden(false) },
  openCreator() {
    this.setData(this.data.activeSection === 'world' ? { showPostEditor: true, keyboardHeight: 0 } : { showWishEditor: true, keyboardHeight: 0 })
    this.setTabBarHidden(true)
  },
  closePostEditor() {
    if (!this.data.saving) {
      wx.hideKeyboard()
      this.setData({ showPostEditor: false, keyboardHeight: 0 })
      this.setTabBarHidden(false)
    }
  },
  closeWishEditor() {
    if (!this.data.saving) {
      wx.hideKeyboard()
      this.setData({ showWishEditor: false, keyboardHeight: 0 })
      this.setTabBarHidden(false)
    }
  },
  stopBubble() {},
  handleKeyboardHeightChange(event) {
    const height = Number(event.detail && event.detail.height) || 0
    if (height !== this.data.keyboardHeight) this.setData({ keyboardHeight: height })
  },
  setPostContent(event) { this.setData({ postContent: event.detail.value }) },
  setWishTitle(event) { this.setData({ wishTitle: event.detail.value }) },
  setWishNote(event) { this.setData({ wishNote: event.detail.value }) },
  selectWishIcon(event) { if (!this.data.saving) this.setData({ wishIcon: event.currentTarget.dataset.icon }) },

  chooseWishImage() {
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
        this.setData({ wishImagePath: file.tempFilePath })
      },
    })
  },

  removeWishImage() { if (!this.data.saving) this.setData({ wishImagePath: '' }) },
  previewWishImage(event) { wx.previewImage({ urls: [event.currentTarget.dataset.src] }) },

  choosePostImage() {
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
        this.setData({ postImagePath: file.tempFilePath })
      },
    })
  },

  removePostImage() { if (!this.data.saving) this.setData({ postImagePath: '' }) },

  async savePost() {
    if (this.data.saving) return
    const content = this.data.postContent.trim()
    if (!content || content.length > 500) {
      wx.showToast({ title: '记录请写 1 到 500 个字', icon: 'none' })
      return
    }
    getApp().renewPartnerReminderSilently()
    this.setData({ saving: true })
    wx.showLoading({ title: '收藏这一刻' })
    let uploadedFileId = ''
    try {
      if (this.data.postImagePath) {
        const cloud = getApp().cloud()
        const cloudPath = await getApp().spaceUploadPath('records')
        const upload = await cloud.uploadFile({ cloudPath, filePath: this.data.postImagePath })
        uploadedFileId = upload.fileID
        await getApp().api('trackSpaceFile', { fileId: uploadedFileId })
      }
      await getApp().api('createMemoryPost', { content, imageFileId: uploadedFileId })
      this.setData({ showPostEditor: false, postContent: '', postImagePath: '', keyboardHeight: 0 })
      this.setTabBarHidden(false)
      await this.loadRecords()
      wx.showToast({ title: '已经记下来啦', icon: 'success' })
    } catch (error) {
      if (uploadedFileId) {
        try { await getApp().cloud().deleteFile({ fileList: [uploadedFileId] }) } catch (cleanupError) { console.warn('record image cleanup failed') }
      }
      wx.showToast({ title: error.message || '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ saving: false })
    }
  },

  async toggleLike(event) {
    const id = event.currentTarget.dataset.id
    const posts = this.data.posts
    const post = posts.find(item => item._id === id)
    if (!post) return
    const before = { liked: post.liked, likeCount: post.likeCount }
    post.liked = !post.liked
    post.likeCount += post.liked ? 1 : -1
    this.setData({ posts })
    try {
      const result = await getApp().api('toggleMemoryLike', { id })
      post.liked = result.liked
      post.likeCount = result.likeCount
      this.setData({ posts })
    } catch (error) {
      Object.assign(post, before)
      this.setData({ posts })
      wx.showToast({ title: error.message || '互动失败', icon: 'none' })
    }
  },

  addComment(event) {
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: '悄悄说句话',
      editable: true,
      placeholderText: '写给对方看，最多 100 字',
      confirmText: '发送',
      confirmColor: '#ff4c8b',
      success: async result => {
        const content = typeof result.content === 'string' ? result.content.trim() : ''
        if (!result.confirm || !content) return
        getApp().renewPartnerReminderSilently()
        try {
          await getApp().api('addMemoryComment', { id, content })
          await this.loadRecords()
          wx.showToast({ title: '评论已送达', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: error.message || '评论失败', icon: 'none' })
        }
      },
    })
  },

  openPostMenu(event) {
    const id = event.currentTarget.dataset.id
    const post = this.data.posts.find(item => item._id === id)
    if (!post || !post.canDelete) {
      wx.showToast({ title: '只能删除自己发布的记录', icon: 'none' })
      return
    }
    wx.showActionSheet({ itemList: ['删除这条记录'], success: () => this.confirmDeletePost(id) })
  },

  confirmDeletePost(id) {
    const post = this.data.posts.find(item => item._id === id)
    wx.showModal({ title: '删除这条记录？', content: '删除后不能恢复。', confirmColor: '#ff4c8b', success: async result => {
      if (!result.confirm) return
      try {
        await getApp().api('deleteMemoryPost', { id })
        await this.loadRecords()
        wx.showToast({ title: '已删除', icon: 'success' })
      } catch (error) { wx.showToast({ title: error.message || '删除失败', icon: 'none' }) }
    } })
  },

  previewPostImage(event) { wx.previewImage({ urls: [event.currentTarget.dataset.src] }) },

  async saveWish() {
    if (this.data.saving) return
    if (!getApp().ensureWritable()) return
    const title = this.data.wishTitle.trim()
    const note = this.data.wishNote.trim()
    if (!title || title.length > 30) {
      wx.showToast({ title: '清单标题请写 1 到 30 个字', icon: 'none' })
      return
    }
    getApp().renewPartnerReminderSilently()
    this.setData({ saving: true })
    wx.showLoading({ title: '放进愿望清单' })
    let uploadedFileId = ''
    try {
      if (this.data.wishImagePath) {
        const cloudPath = await getApp().spaceUploadPath('wishes')
        const upload = await getApp().cloud().uploadFile({ cloudPath, filePath: this.data.wishImagePath })
        uploadedFileId = upload.fileID
        await getApp().api('trackSpaceFile', { fileId: uploadedFileId })
      }
      await getApp().api('createWish', { title, note, icon: this.data.wishIcon, imageFileId: uploadedFileId })
      this.setData({ showWishEditor: false, wishTitle: '', wishNote: '', wishIcon: '💗', wishImagePath: '', keyboardHeight: 0 })
      this.setTabBarHidden(false)
      await this.loadRecords()
      wx.showToast({ title: '愿望已放进清单', icon: 'success' })
    } catch (error) {
      if (uploadedFileId) {
        try { await getApp().cloud().deleteFile({ fileList: [uploadedFileId] }) } catch (cleanupError) { console.warn('wish image cleanup failed') }
      }
      wx.showToast({ title: error.message || '添加失败', icon: 'none' })
    } finally { wx.hideLoading(); this.setData({ saving: false }) }
  },

  async toggleWish(event) {
    const id = event.currentTarget.dataset.id
    const completed = event.currentTarget.dataset.completed === true || event.currentTarget.dataset.completed === 1 || event.currentTarget.dataset.completed === 'true'
    getApp().renewPartnerReminderSilently()
    try {
      await getApp().api('toggleWish', { id, completed: !completed })
      await this.loadRecords()
      wx.showToast({ title: completed ? '已放回待完成' : '一起完成啦', icon: 'success' })
    } catch (error) { wx.showToast({ title: error.message || '更新失败', icon: 'none' }) }
  },

  deleteWish(event) {
    const id = event.currentTarget.dataset.id
    const list = [...this.data.pendingWishes, ...this.data.completedWishes]
    const wish = list.find(item => item._id === id)
    if (!wish || !wish.canDelete) {
      wx.showToast({ title: '只能删除自己写下的愿望', icon: 'none' })
      return
    }
    wx.showModal({ title: `删除“${wish.title}”？`, content: '长久的愿望也可以先留着慢慢完成。', confirmColor: '#ff4c8b', success: async result => {
      if (!result.confirm) return
      try {
        await getApp().api('deleteWish', { id })
        await this.loadRecords()
        wx.showToast({ title: '已删除', icon: 'success' })
      } catch (error) { wx.showToast({ title: error.message || '删除失败', icon: 'none' }) }
    } })
  },
})
