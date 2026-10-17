function isMissingCode(code) {
  return code === -503003 || String(code || '').toUpperCase() === 'STORAGE_FILE_NONEXIST'
}

function rowStatus(row) {
  return row && row.code !== undefined ? row.code : row && row.status
}

async function confirmedMissing(fileId, inspectFile) {
  if (typeof inspectFile !== 'function') return false
  try {
    const result = await inspectFile(fileId)
    const row = result && Array.isArray(result.fileList)
      ? result.fileList.find(item => item && (item.fileID === fileId || item.fileId === fileId))
      : null
    return Boolean(row && isMissingCode(rowStatus(row)))
  } catch (error) {
    return isMissingCode(error && (error.errCode || error.code))
  }
}

async function deleteCloudFilesStrict(fileIds, deleteFile, inspectFile) {
  if (!Array.isArray(fileIds) || !fileIds.length) return
  let result
  try {
    result = await deleteFile({ fileList: fileIds })
  } catch (error) {
    for (const fileId of fileIds) {
      if (!await confirmedMissing(fileId, inspectFile)) throw error
    }
    return
  }
  const rows = result && Array.isArray(result.fileList) ? result.fileList : []
  for (const fileId of fileIds) {
    const row = rows.find(item => item && (item.fileID === fileId || item.fileId === fileId))
    const code = rowStatus(row)
    if (!row || (code !== 'SUCCESS' && code !== 0 && !isMissingCode(code))) {
      if (await confirmedMissing(fileId, inspectFile)) continue
      const error = new Error('cloud file deletion was not fully successful')
      error.code = 'FILE_DELETE_FAILED'
      throw error
    }
  }
}

function createCloudFileCleanup(cloud) {
  return fileIds => deleteCloudFilesStrict(
    fileIds,
    options => cloud.deleteFile(options),
    fileId => cloud.getTempFileURL({ fileList: [fileId] }),
  )
}

module.exports = { createCloudFileCleanup, deleteCloudFilesStrict, isMissingCode }
