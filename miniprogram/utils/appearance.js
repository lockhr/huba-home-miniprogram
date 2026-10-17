const { avatarView, validatePickedImage } = require('./space.js')

const DEFAULT_APPEARANCE_IMAGES = Object.freeze({
  hero: '/images/brand/hero-home.jpg',
  anniversary: '/images/brand/decor-calendar.png',
  rules: '/images/brand/decor-diary.png',
  welcome: '/images/brand/decor-letter.png',
  mission: '/images/brand/hero-home.jpg',
  market: '/images/brand/hero-home.jpg',
  records: '/images/brand/mascot-pair.png',
  dinner: '/images/brand/hero-home.jpg',
  storage: '/images/brand/hero-home.jpg',
})

const APPEARANCE_SLOTS = Object.freeze([
  { key: 'hero', field: 'heroImageFileId', label: '主页封面', icon: '🌄' },
  { key: 'anniversary', field: 'anniversaryImageFileId', label: '纪念日插画', icon: '💞' },
  { key: 'rules', field: 'rulesImageFileId', label: '家规插画', icon: '📖' },
  { key: 'welcome', field: 'welcomeImageFileId', label: '欢迎信插画', icon: '💌' },
  { key: 'mission', field: 'missionImageFileId', label: '任务主题图', icon: '📝' },
  { key: 'market', field: 'marketImageFileId', label: '商城主题图', icon: '🎁' },
  { key: 'records', field: 'recordsImageFileId', label: '记录主题图', icon: '📷' },
  { key: 'dinner', field: 'dinnerImageFileId', label: '晚餐主题图', icon: '🍽️' },
  { key: 'storage', field: 'storageImageFileId', label: '仓库主题图', icon: '🧰' },
])

function appearanceView(space) {
  const appearance = space && space.appearance && typeof space.appearance === 'object' ? space.appearance : {}
  return Object.fromEntries(APPEARANCE_SLOTS.map(slot => {
    const urlField = slot.field.replace(/FileId$/, 'Url')
    const signed = appearance[urlField]
    const legacy = appearance[slot.field]
    const source = Object.prototype.hasOwnProperty.call(appearance, urlField)
      ? typeof signed === 'string' && signed ? signed : DEFAULT_APPEARANCE_IMAGES[slot.key]
      : typeof legacy === 'string' && legacy ? legacy : DEFAULT_APPEARANCE_IMAGES[slot.key]
    return [slot.key, source]
  }))
}

function appearanceDisplayCustom(space) {
  const appearance = space && space.appearance && typeof space.appearance === 'object' ? space.appearance : {}
  return Object.fromEntries(APPEARANCE_SLOTS.map(slot => {
    const fileId = appearance[slot.field]
    const urlField = slot.field.replace(/FileId$/, 'Url')
    const resolved = Object.prototype.hasOwnProperty.call(appearance, urlField)
      ? typeof appearance[urlField] === 'string' && Boolean(appearance[urlField])
      : typeof fileId === 'string' && Boolean(fileId)
    return [slot.key, Boolean(fileId && resolved)]
  }))
}

function pageAppearance(app) {
  const globalSpace = app && app.globalData && app.globalData.space
  const bootstrapSpace = app && app.bootstrap && app.bootstrap.space
  return appearanceView(globalSpace || bootstrapSpace || null)
}

function pageAppearanceDisplayCustom(app) {
  const globalSpace = app && app.globalData && app.globalData.space
  const bootstrapSpace = app && app.bootstrap && app.bootstrap.space
  return appearanceDisplayCustom(globalSpace || bootstrapSpace || null)
}

async function refreshPageAppearance(page, app) {
  if (app && typeof app.loadBootstrap === 'function') {
    try { await app.loadBootstrap() } catch (error) { /* 保留上一份安全视图，业务页仍可继续重试自己的数据 */ }
  }
  const appearance = pageAppearance(app)
  if (page && typeof page.setData === 'function') {
    page.setData({ appearance, appearanceDisplayCustom: pageAppearanceDisplayCustom(app) })
  }
  return appearance
}

function avatarViewModel(user) {
  const source = user || {}
  const hasSignedUrl = Object.prototype.hasOwnProperty.call(source, 'avatarUrl')
  return {
    imageFileId: hasSignedUrl
      ? typeof source.avatarUrl === 'string' ? source.avatarUrl : ''
      : typeof source.avatarFileId === 'string' ? source.avatarFileId : '',
    glyph: avatarView(source.avatarKey).glyph,
  }
}

function safeUploadFolder(value) {
  const folder = typeof value === 'string' ? value.trim() : ''
  const segments = folder.split('/')
  if (!folder || folder.startsWith('/') || folder.includes('\\') || !/^[a-z0-9/-]+$/.test(folder)
    || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('上传目录不合法')
  }
  return folder
}

function chooseImage(wxApi) {
  return new Promise((resolve, reject) => {
    wxApi.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: result => resolve(result && result.tempFiles && result.tempFiles[0]),
      fail: error => {
        if (/cancel/i.test(String(error && error.errMsg || ''))) resolve(null)
        else reject(error)
      },
    })
  })
}

function createAppearanceUploader({ wxApi, app }) {
  if (!wxApi || typeof wxApi.chooseMedia !== 'function' || !app) throw new TypeError('appearance uploader dependencies are required')

  function targetOf({ kind, slot }) {
    if (kind === 'avatar') return { folder: 'appearance/avatar', action: 'setMyAvatarImage', data: {} }
    const known = APPEARANCE_SLOTS.some(item => item.key === slot)
    if (kind !== 'space' || !known) throw new Error('请选择有效的装扮位置')
    return { folder: `appearance/${slot}`, action: 'setSpaceAppearance', data: { slot } }
  }

  async function committedReference(target, imageFileId) {
    if (typeof app.loadBootstrap !== 'function') return null
    try {
      const bootstrap = await app.loadBootstrap()
      if (target.kind === 'avatar') {
        return Boolean(bootstrap && bootstrap.user && bootstrap.user.avatarFileId === imageFileId)
      }
      const descriptor = APPEARANCE_SLOTS.find(item => item.key === target.slot)
      const appearance = bootstrap && bootstrap.space && bootstrap.space.appearance
      return Boolean(descriptor && appearance && appearance[descriptor.field] === imageFileId)
    } catch (error) {
      // 连刷新也失败时，提交结果未知。宁可留下待台账/空间清理的孤儿文件，
      // 也不能误删可能已经成为当前头像或装饰图的新文件。
      return null
    }
  }

  async function replace(target) {
    if (!app.ensureWritable()) return { cancelled: true }
    const selected = await chooseImage(wxApi)
    if (!selected || !selected.tempFilePath) return { cancelled: true }
    const validation = validatePickedImage(selected)
    if (!validation.ok) throw new Error(validation.error)
    const descriptor = targetOf(target)
    const cloudPath = await app.spaceUploadPath(safeUploadFolder(descriptor.folder))
    const cloud = app.cloud()
    let imageFileId = ''
    try {
      const uploaded = await cloud.uploadFile({ cloudPath, filePath: selected.tempFilePath })
      imageFileId = uploaded && uploaded.fileID
      if (!imageFileId) throw new Error('图片上传失败，请稍后再试')
      return await app.api(descriptor.action, { ...descriptor.data, imageFileId })
    } catch (error) {
      const committed = imageFileId ? await committedReference(target, imageFileId) : false
      if (committed === true) return { ...descriptor.data, imageFileId, recovered: true }
      if (imageFileId && committed === false) {
        try { await cloud.deleteFile({ fileList: [imageFileId] }) } catch (cleanupError) { /* 台账清理会兜底 */ }
      }
      throw error
    }
  }

  async function reset(target) {
    if (!app.ensureWritable()) return { cancelled: true }
    const descriptor = targetOf(target)
    return app.api(descriptor.action, { ...descriptor.data, imageFileId: '' })
  }

  return { replace, reset }
}

module.exports = {
  APPEARANCE_SLOTS,
  DEFAULT_APPEARANCE_IMAGES,
  appearanceView,
  appearanceDisplayCustom,
  pageAppearance,
  pageAppearanceDisplayCustom,
  refreshPageAppearance,
  avatarViewModel,
  createAppearanceUploader,
  safeUploadFolder,
}
