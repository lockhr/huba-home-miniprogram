const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createScheduleOcr } = require('../cloudfunctions/api/schedule-ocr.js')

test('OCR 未配置授权时不上传截图，也不暴露云端密钥', async () => {
  let downloaded = false
  const recognize = createScheduleOcr({ downloadFile: async () => { downloaded = true } }, {}, async () => { throw new Error('should not request') })
  await assert.rejects(() => recognize('cloud://test/couples/space-1/schedule-import/a.jpg'), error => error.code === 'SCHEDULE_OCR_UNAVAILABLE')
  assert.equal(downloaded, false)
})

test('OCR 使用云端临时凭证签名，仅向腾讯表格接口发送图片', async () => {
  let request
  const image = Buffer.from('jpeg bytes')
  const recognize = createScheduleOcr(
    { downloadFile: async () => ({ fileContent: image }) },
    { TENCENTCLOUD_SECRETID: 'test-id', TENCENTCLOUD_SECRETKEY: 'test-key', TENCENTCLOUD_SESSIONTOKEN: 'test-token' },
    async args => { request = args; return { Response: { TableDetections: [{ Cells: [] }] } } },
  )
  const result = await recognize('cloud://test/couples/space-1/schedule-import/a.jpg')
  assert.equal(result.TableDetections.length, 1)
  assert.equal(request.host, 'ocr.tencentcloudapi.com')
  assert.equal(request.headers['X-TC-Action'], 'RecognizeTableAccurateOCR')
  assert.equal(request.headers['X-TC-Token'], 'test-token')
  assert.equal(JSON.parse(request.body).ImageBase64, image.toString('base64'))
  assert.match(request.headers.Authorization, /^TC3-HMAC-SHA256 Credential=test-id\//)
})
