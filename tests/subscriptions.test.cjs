const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadSubscriptions(wx) {
  const module = { exports: {} }
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../miniprogram/utils/subscriptions.js'), 'utf8'),
    {
      module,
      exports: module.exports,
      require(filename) {
        assert.equal(filename, '../config.runtime.js')
        return { subscribeTemplateId: 'template-test' }
      },
      wx,
      Promise,
      Error,
    },
  )
  return module.exports
}

test('自动续领只在微信已经记住允许选择后触发', async () => {
  const storage = new Map()
  let requests = 0
  const wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    getSetting({ success }) {
      success({
        subscriptionsSetting: {
          mainSwitch: true,
          itemSettings: { 'template-test': 'accept' },
        },
      })
    },
    requestSubscribeMessage({ success }) {
      requests += 1
      success({ 'template-test': 'accept' })
    },
  }
  const subscriptions = loadSubscriptions(wx)

  await subscriptions.getPartnerReminderStatus()
  const result = await subscriptions.requestAutoPartnerReminder()

  assert.equal(requests, 1)
  assert.equal(result.status, 'accept')
})

test('未选择始终允许时不会在正常操作中打断用户', async () => {
  const storage = new Map()
  let requests = 0
  const wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    getSetting({ success }) {
      success({ subscriptionsSetting: { mainSwitch: true, itemSettings: {} } })
    },
    requestSubscribeMessage() { requests += 1 },
  }
  const subscriptions = loadSubscriptions(wx)

  await subscriptions.getPartnerReminderStatus()
  const result = await subscriptions.requestAutoPartnerReminder()

  assert.equal(requests, 0)
  assert.equal(result, null)
})
