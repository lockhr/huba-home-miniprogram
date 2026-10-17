const test = require('node:test')
const assert = require('node:assert/strict')
const { createCloudFileCleanup, deleteCloudFilesStrict } = require('../cloudfunctions/api/file-cleanup.js')

test('云文件逐项删除全部成功才算完成', async () => {
  await deleteCloudFilesStrict(['cloud://env/a', 'cloud://env/b'], async () => ({
    fileList: [{ fileID: 'cloud://env/a', code: 'SUCCESS' }, { fileID: 'cloud://env/b', code: 'SUCCESS' }],
  }))
})

test('任一云文件逐项失败就抛错，让数据库记录留给重试', async () => {
  await assert.rejects(
    () => deleteCloudFilesStrict(['cloud://env/a'], async () => ({ fileList: [{ fileID: 'cloud://env/a', code: 'STORAGE_INTERNAL_ERROR' }] })),
    error => error.code === 'FILE_DELETE_FAILED',
  )
})

test('云端明确返回文件不存在时按幂等成功处理', async () => {
  await deleteCloudFilesStrict(['cloud://env/a'], async () => ({ fileList: [{ fileID: 'cloud://env/a', code: 'STORAGE_FILE_NONEXIST' }] }))
})

test('wx-server-sdk 实际使用 status 0 表示删除成功', async () => {
  await deleteCloudFilesStrict(['cloud://env/a'], async () => ({ fileList: [{ fileID: 'cloud://env/a', status: 0, errMsg: 'ok' }] }))
})

test('wx-server-sdk 实际使用 status -503003 表示单个文件不存在', async () => {
  await deleteCloudFilesStrict(['cloud://env/a'], async () => ({ fileList: [{ fileID: 'cloud://env/a', status: -503003 }] }))
})

test('wx-server-sdk 实际使用 status -503003 复核已不存在文件', async () => {
  await deleteCloudFilesStrict(['cloud://env/a'], async () => ({ fileList: [{ fileID: 'cloud://env/a', status: -503001 }] }), async fileId => ({
    fileList: [{ fileID: fileId, status: -503003, tempFileURL: '' }],
  }))
})

test('wx-server-sdk 的存储权限错误不能当作文件不存在', async () => {
  await assert.rejects(
    () => deleteCloudFilesStrict(['cloud://env/a'], async () => ({ fileList: [{ fileID: 'cloud://env/a', status: -503002 }] }), async fileId => ({
      fileList: [{ fileID: fileId, status: -503002 }],
    })),
    error => error.code === 'FILE_DELETE_FAILED',
  )
})

for (const code of ['STORAGE_BUCKET_NOT_FOUND', 'STORAGE_NOT_EXIST', '404', 'STORAGE_PERMISSION_DENIED', 'STORAGE_TIMEOUT']) {
  test(`删除响应 ${code} 不得误当作单个文件不存在`, async () => {
    await assert.rejects(
      () => deleteCloudFilesStrict(['cloud://env/a'], async () => ({ fileList: [{ fileID: 'cloud://env/a', code }] })),
      error => error.code === 'FILE_DELETE_FAILED',
    )
  })

  test(`只读复核响应 ${code} 不得误当作单个文件不存在`, async () => {
    const original = Object.assign(new Error('delete failed'), { code: 'DELETE_FAILED' })
    await assert.rejects(
      () => deleteCloudFilesStrict(['cloud://env/a'], async () => { throw original }, async fileId => ({
        fileList: [{ fileID: fileId, code }],
      })),
      error => error === original,
    )
  })
}

test('删除调用失败但只读复核确认文件已不存在时允许继续', async () => {
  let checked = 0
  await deleteCloudFilesStrict(['cloud://env/a'], async () => {
    throw Object.assign(new Error('delete failed'), { code: 'UNKNOWN' })
  }, async fileId => {
    assert.equal(fileId, 'cloud://env/a')
    checked += 1
    return { fileList: [{ fileID: fileId, code: 'STORAGE_FILE_NONEXIST' }] }
  })
  assert.equal(checked, 1)
})

test('只读复核仍能访问文件时保留原删除错误', async () => {
  const original = Object.assign(new Error('delete failed'), { code: 'STORAGE_PERMISSION_DENIED' })
  await assert.rejects(
    () => deleteCloudFilesStrict(['cloud://env/a'], async () => { throw original }, async fileId => ({
      fileList: [{ fileID: fileId, code: 'SUCCESS', tempFileURL: 'https://example.invalid/a' }],
    })),
    error => error === original,
  )
})

test('删除返回未知逐项错误且复核未确认缺失时不能推进', async () => {
  await assert.rejects(
    () => deleteCloudFilesStrict(['cloud://env/a'], async () => ({
      fileList: [{ fileID: 'cloud://env/a', code: 'STORAGE_INTERNAL_ERROR' }],
    }), async () => ({ fileList: [] })),
    error => error.code === 'FILE_DELETE_FAILED',
  )
})

test('云函数适配器把失败的删除交给只读文件状态复核', async () => {
  let lookups = 0
  const deleteFiles = createCloudFileCleanup({
    async deleteFile() { throw Object.assign(new Error('failed'), { code: 'UNKNOWN' }) },
    async getTempFileURL({ fileList }) {
      lookups += 1
      return { fileList: [{ fileID: fileList[0], code: 'STORAGE_FILE_NONEXIST' }] }
    },
  })
  await deleteFiles(['cloud://env/a'])
  assert.equal(lookups, 1)
})
