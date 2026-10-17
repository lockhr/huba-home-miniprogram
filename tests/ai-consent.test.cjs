const test = require('node:test')
const assert = require('node:assert/strict')

const { AI_CONSENT_KEY, ensureAiConsent } = require('../miniprogram/utils/ai-consent.js')

test('已有小八同意记录时不重复弹窗', async () => {
  let modalCalls = 0
  const wxApi = {
    getStorageSync: key => key === AI_CONSENT_KEY,
    showModal: () => { modalCalls += 1 },
  }
  assert.equal(await ensureAiConsent(wxApi), true)
  assert.equal(modalCalls, 0)
})

test('明确同意后保存本机记录，拒绝时不保存', async () => {
  const saved = []
  let modalOptions
  const accepted = {
    getStorageSync: () => false,
    setStorageSync: (key, value) => saved.push({ key, value }),
    showModal: options => { modalOptions = options; options.success({ confirm: true }) },
  }
  assert.equal(await ensureAiConsent(accepted), true)
  assert.deepEqual(saved, [{ key: AI_CONSENT_KEY, value: true }])
  assert.ok(modalOptions.confirmText.length <= 4, '微信弹窗确认按钮最多 4 个汉字')
  assert.ok(modalOptions.cancelText.length <= 4, '微信弹窗取消按钮最多 4 个汉字')

  const rejected = {
    getStorageSync: () => false,
    setStorageSync: () => assert.fail('拒绝后不应保存同意'),
    showModal: options => options.success({ confirm: false }),
  }
  assert.equal(await ensureAiConsent(rejected), false)
})
