const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createImageModerator, createTextModerator } = require('../cloudfunctions/api/content-safety.js')
const { createService } = require('../cloudfunctions/api/service.js')
const { MemoryStore, pairedSpace } = require('./helpers/memory-store.cjs')

test('文本安全适配器放行安全内容，并把风险与服务故障分成稳定错误码', async () => {
  await createTextModerator(async () => ({ errCode: 0 }))('普通内容')

  const risky = createTextModerator(async () => ({ errCode: 87014, errMsg: 'risky content' }))
  await assert.rejects(() => risky('敏感原文'), error => error.code === 'CONTENT_REJECTED' && !error.message.includes('敏感原文'))

  const unavailable = createTextModerator(async () => { throw new Error('network failed') })
  await assert.rejects(() => unavailable('不应出现在错误里的原文'), error => error.code === 'CONTENT_CHECK_UNAVAILABLE' && !error.message.includes('原文'))
})

test('审核接口空响应不能被当成通过', async () => {
  for (const response of [undefined, null, {}]) {
    await assert.rejects(
      () => createTextModerator(async () => response)('普通内容'),
      error => error.code === 'CONTENT_CHECK_UNAVAILABLE',
    )
    await assert.rejects(
      () => createImageModerator(
        async () => ({ fileContent: Buffer.from([0xff, 0xd8, 0xff, 0x00]) }),
        async () => response,
      )('cloud://test/photo.jpg'),
      error => error.code === 'CONTENT_CHECK_UNAVAILABLE',
    )
  }
})

test('公开环境内容审核失败时禁止写入，且不留下半条记录', async () => {
  const store = new MemoryStore(pairedSpace())
  const checked = []
  const service = createService(store, () => '2026-09-21T00:00:00.000Z', null, {
    contentSafetyRequired: true,
    moderateText: async text => {
      checked.push(text)
      const error = new Error('blocked')
      error.code = 'CONTENT_REJECTED'
      throw error
    },
  })

  await assert.rejects(
    () => service.execute('createHouseRule', { content: '不合规内容' }, 'a'),
    error => error.code === 'CONTENT_REJECTED',
  )
  assert.deepEqual(checked, ['不合规内容'])
  assert.equal(store.data.HouseRuleList.length, 0)
})

test('公开环境没有可用审核器时关闭写入口，而不是静默绕过', async () => {
  const store = new MemoryStore(pairedSpace())
  const service = createService(store, () => '2026-09-21T00:00:00.000Z', null, { contentSafetyRequired: true })
  await assert.rejects(
    () => service.execute('createWish', { title: '一起旅行' }, 'a'),
    error => error.code === 'CONTENT_CHECK_UNAVAILABLE',
  )
  assert.equal(store.data.WishList.length, 0)
})

test('图片安全适配器先下载云文件再审核，风险图片与下载失败都不会放行', async () => {
  const calls = []
  const moderate = createImageModerator(
    async ({ fileID }) => ({ fileContent: Buffer.from([0xff, 0xd8, 0xff, 0x00]), fileID }),
    async options => { calls.push(options); return { errCode: 0 } },
  )
  await moderate('cloud://env.bucket/couples/space-1/records/a.jpg')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].media.contentType, 'image/jpeg')
  assert.ok(Buffer.isBuffer(calls[0].media.value))

  const risky = createImageModerator(
    async () => ({ fileContent: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }),
    async () => ({ errCode: 87014 }),
  )
  await assert.rejects(() => risky('cloud://safe-path'), error => error.code === 'CONTENT_REJECTED')

  const unavailable = createImageModerator(async () => { throw new Error('download failed') }, async () => ({ errCode: 0 }))
  await assert.rejects(() => unavailable('cloud://safe-path'), error => error.code === 'CONTENT_CHECK_UNAVAILABLE')
})

test('公开环境图片未通过审核时不创建记录', async () => {
  const store = new MemoryStore(pairedSpace())
  const service = createService(store, () => '2026-09-21T00:00:00.000Z', null, {
    contentSafetyRequired: true,
    moderateText: async () => {},
    moderateImage: async () => { const error = new Error('blocked'); error.code = 'CONTENT_REJECTED'; throw error },
    costGuard: { image: true },
  })
  const imageFileId = 'cloud://env.bucket/couples/space-1/records/a.jpg'
  await assert.rejects(
    () => service.execute('createMemoryPost', { content: '普通文字', imageFileId }, 'a'),
    error => error.code === 'CONTENT_REJECTED',
  )
  assert.equal(store.data.MemoryPostList.length, 0)
})
