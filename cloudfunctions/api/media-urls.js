const { APPEARANCE_FIELDS, validateAppearanceImage } = require('./appearance.js')

const SHARED_MEDIA_ACTIONS = new Set([
  'getBootstrap',
  'getRecords',
  'getDinnerData',
  'setSpaceAppearance',
  'setMyAvatarImage',
])

function imageTargets(data) {
  const items = []
  const addItems = values => {
    if (!Array.isArray(values)) return
    values.forEach(item => {
      if (item && typeof item === 'object') items.push({ holder: item, idKey: 'imageFileId', urlKey: 'imageUrl' })
    })
  }
  addItems(data && data.posts)
  addItems(data && data.dishes)
  addItems(data && data.wishes)
  if (data && Array.isArray(data.orders)) data.orders.forEach(order => addItems(order && order.items))

  if (data && typeof data === 'object' && data.imageFileId) {
    items.push({ holder: data, idKey: 'imageFileId', urlKey: 'imageUrl' })
  }

  const bootstrapSpaceId = data && data.space && data.space._id
  const addBootstrapTarget = (holder, idKey, urlKey, folder) => {
    if (!holder || typeof holder !== 'object') return
    const fileId = holder[idKey]
    if (!fileId) return
    try {
      validateAppearanceImage(fileId, bootstrapSpaceId, folder)
      items.push({ holder, idKey, urlKey })
    } catch (error) {
      holder[idKey] = ''
      holder[urlKey] = ''
    }
  }
  for (const member of [data && data.user, data && data.partner]) {
    addBootstrapTarget(member, 'avatarFileId', 'avatarUrl', 'avatar')
  }
  const appearance = data && data.space && data.space.appearance
  if (appearance && typeof appearance === 'object' && !Array.isArray(appearance)) {
    Object.entries(APPEARANCE_FIELDS).forEach(([slot, idKey]) => {
      addBootstrapTarget(appearance, idKey, idKey.replace(/FileId$/, 'Url'), slot)
    })
  }
  return items
}

async function resolveSharedMedia(data, getTempFileURL) {
  const targets = imageTargets(data)
  const fileList = [...new Set(targets.map(target => target.holder[target.idKey]).filter(value => typeof value === 'string' && value.startsWith('cloud://')))]
  if (!fileList.length || typeof getTempFileURL !== 'function') return data

  const resolvedFiles = []
  try {
    for (let index = 0; index < fileList.length; index += 50) {
      const response = await getTempFileURL(fileList.slice(index, index + 50))
      resolvedFiles.push(...((response && response.fileList) || []))
    }
  } catch (error) {
    console.warn('shared image URL resolution failed', error && error.message)
    targets.forEach(target => {
      if (target.holder[target.idKey]) target.holder[target.urlKey] = ''
    })
    return data
  }

  const urlById = new Map(resolvedFiles.map(file => [
    file.fileID || file.fileId,
    file.tempFileURL || file.tempFileUrl || '',
  ]))
  targets.forEach(target => {
    const fileId = target.holder[target.idKey]
    if (fileId) target.holder[target.urlKey] = urlById.get(fileId) || ''
  })
  return data
}

function shouldResolveSharedMedia(action) {
  return SHARED_MEDIA_ACTIONS.has(action)
}

module.exports = { resolveSharedMedia, shouldResolveSharedMedia }
