const { compact, fail, spaceImagePrefix, validateSpaceImage } = require('./shared.js')

const APPEARANCE_FIELDS = Object.freeze({
  hero: 'heroImageFileId',
  anniversary: 'anniversaryImageFileId',
  rules: 'rulesImageFileId',
  welcome: 'welcomeImageFileId',
  mission: 'missionImageFileId',
  market: 'marketImageFileId',
  records: 'recordsImageFileId',
  dinner: 'dinnerImageFileId',
  storage: 'storageImageFileId',
})

function appearanceOf(space) {
  const source = space && space.appearance && typeof space.appearance === 'object' && !Array.isArray(space.appearance)
    ? space.appearance
    : {}
  return Object.fromEntries(Object.values(APPEARANCE_FIELDS).map(field => [field, compact(source[field])]))
}

function safeAppearanceOf(space) {
  const appearance = appearanceOf(space)
  const spaceId = compact(space && space._id)
  for (const [slot, field] of Object.entries(APPEARANCE_FIELDS)) {
    if (!appearance[field] || !spaceId) {
      appearance[field] = ''
      continue
    }
    try {
      appearance[field] = validateAppearanceImage(appearance[field], spaceId, slot)
    } catch (error) {
      appearance[field] = ''
    }
  }
  return appearance
}

function safeAvatarFileId(user, spaceId) {
  const fileId = compact(user && user.avatarFileId)
  if (!fileId || !compact(spaceId)) return ''
  try {
    return validateAppearanceImage(fileId, spaceId, 'avatar')
  } catch (error) {
    return ''
  }
}

function appearanceField(slot) {
  const field = APPEARANCE_FIELDS[compact(slot)]
  if (!field) fail('INVALID_APPEARANCE_SLOT')
  return field
}

function cloudObjectPath(fileId) {
  const slash = fileId.indexOf('/', 'cloud://'.length)
  return slash < 0 ? '' : fileId.slice(slash + 1)
}

function validateAppearanceImage(value, spaceId, folder) {
  const fileId = validateSpaceImage(value, spaceId)
  if (!fileId) return ''
  const expected = `${spaceImagePrefix(spaceId)}appearance/${folder}/`
  if (!cloudObjectPath(fileId).startsWith(expected)) fail('INVALID_APPEARANCE_IMAGE')
  return fileId
}

module.exports = { APPEARANCE_FIELDS, appearanceField, appearanceOf, safeAppearanceOf, safeAvatarFileId, validateAppearanceImage }
