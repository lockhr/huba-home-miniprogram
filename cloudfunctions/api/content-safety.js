function moderationError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function responseCode(result) {
  const value = result && (result.errCode ?? result.errcode)
  return value === undefined || value === null || value === '' ? NaN : Number(value)
}

function createTextModerator(check) {
  if (typeof check !== 'function') throw new TypeError('content safety check is required')
  return async content => {
    const text = typeof content === 'string' ? content.trim() : ''
    if (!text) return
    try {
      const result = await check({ content: text })
      const code = responseCode(result)
      const suggest = String(result && (result.suggest || (result.result && result.result.suggest)) || '').toLowerCase()
      if (code === 87014 || suggest === 'risky' || suggest === 'review') throw moderationError('CONTENT_REJECTED')
      if (code !== 0) throw moderationError('CONTENT_CHECK_UNAVAILABLE')
    } catch (error) {
      const code = Number(error && (error.errCode ?? error.errcode))
      if (error && error.code === 'CONTENT_REJECTED' || code === 87014) throw moderationError('CONTENT_REJECTED')
      throw moderationError('CONTENT_CHECK_UNAVAILABLE')
    }
  }
}

function imageContentType(buffer) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif'
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45) return 'image/webp'
  return 'image/jpeg'
}

function createImageModerator(download, check) {
  if (typeof download !== 'function' || typeof check !== 'function') throw new TypeError('image safety dependencies are required')
  return async fileID => {
    try {
      const downloaded = await download({ fileID })
      const content = downloaded && downloaded.fileContent
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content || [])
      if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw moderationError('CONTENT_CHECK_UNAVAILABLE')
      const result = await check({ media: { contentType: imageContentType(buffer), value: buffer } })
      const code = responseCode(result)
      const suggest = String(result && (result.suggest || (result.result && result.result.suggest)) || '').toLowerCase()
      if (code === 87014 || suggest === 'risky' || suggest === 'review') throw moderationError('CONTENT_REJECTED')
      if (code !== 0) throw moderationError('CONTENT_CHECK_UNAVAILABLE')
    } catch (error) {
      const code = Number(error && (error.errCode ?? error.errcode))
      if (error && error.code === 'CONTENT_REJECTED' || code === 87014) throw moderationError('CONTENT_REJECTED')
      throw moderationError('CONTENT_CHECK_UNAVAILABLE')
    }
  }
}

module.exports = { createImageModerator, createTextModerator }
