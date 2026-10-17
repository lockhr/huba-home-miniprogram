const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadRecordsPage(apiImpl = async () => ({})) {
  let page
  const calls = []
  const fileId = 'cloud://test/couples/space-1/wishes/one.jpg'
  const app = {
    ensureWritable: () => true,
    renewPartnerReminderSilently() {},
    spaceUploadPath: async folder => `couples/space-1/${folder}/one.jpg`,
    cloud: () => ({
      uploadFile: async value => { calls.push({ kind: 'upload', value }); return { fileID: fileId } },
      deleteFile: async value => { calls.push({ kind: 'delete', value }) },
    }),
    api: async (action, data) => { calls.push({ kind: 'api', action, data }); return apiImpl(action, data) },
  }
  const wx = {
    chooseMedia: options => options.success({ tempFiles: [{ tempFilePath: '/tmp/photo.jpg', size: 5000 }] }),
    showToast() {}, showLoading() {}, hideLoading() {}, hideKeyboard() {},
  }
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/Records/index.js'), 'utf8')
  vm.runInNewContext(source, {
    Page: value => { page = value }, getApp: () => app, wx,
    require: filename => {
      if (filename === '../../utils/share.js') return require('../miniprogram/utils/share.js')
      if (filename === '../../utils/space.js') return require('../miniprogram/utils/space.js')
      if (filename === '../../utils/appearance.js') return require('../miniprogram/utils/appearance.js')
      throw new Error(`unknown dependency ${filename}`)
    },
    console: { warn() {} },
  })
  page.setData = patch => Object.assign(page.data, patch)
  page.loadRecords = async () => {}
  return { page, calls, fileId }
}

test('心愿编辑器可选图，并只在用户保存时上传到当前空间', async () => {
  const { page, calls, fileId } = loadRecordsPage()
  page.chooseWishImage()
  assert.equal(page.data.wishImagePath, '/tmp/photo.jpg')
  assert.equal(calls.length, 0)
  page.setData({ wishTitle: '一起看海', wishNote: '等晴天' })
  await page.saveWish()
  assert.equal(calls.find(call => call.kind === 'upload').value.cloudPath, 'couples/space-1/wishes/one.jpg')
  assert.equal(calls.find(call => call.action === 'createWish').data.imageFileId, fileId)
  assert.equal(page.data.wishImagePath, '')
})

test('心愿保存失败时清理本次上传，避免孤儿图片', async () => {
  const { page, calls, fileId } = loadRecordsPage(async action => {
    if (action === 'createWish') throw new Error('save failed')
    return {}
  })
  page.chooseWishImage()
  page.setData({ wishTitle: '一起看海' })
  await page.saveWish()
  assert.deepEqual(Array.from(calls.find(call => call.kind === 'delete').value.fileList), [fileId])
  assert.equal(page.data.saving, false)
})
