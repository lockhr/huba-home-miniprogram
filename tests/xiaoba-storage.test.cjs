const { test } = require('node:test')
const assert = require('node:assert/strict')
const { AI_CONSENT_KEY } = require('../miniprogram/utils/ai-consent.js')
const { historyKey, reconcileXiaoBaScope, clearXiaoBaSession } = require('../miniprogram/utils/xiaoba-storage.js')

function fakeStorage() {
  const values = new Map()
  return {
    values,
    getStorageSync: key => values.get(key),
    setStorageSync: (key, value) => values.set(key, value),
    removeStorageSync: key => values.delete(key),
  }
}

test('小八对话按本人、空间和伴侣隔离，旧全局缓存不迁移', () => {
  const wx = fakeStorage()
  const first = { user: { openid: 'a' }, space: { _id: 'one' }, partner: { openid: 'b' } }
  const second = { user: { openid: 'a' }, space: { _id: 'two' }, partner: { openid: 'c' } }
  const firstKey = historyKey(first)
  const secondKey = historyKey(second)
  assert.notEqual(firstKey, secondKey)
  wx.setStorageSync('huba_xiaoba_messages_v2', [{ content: '旧版对话' }])
  reconcileXiaoBaScope(wx, first)
  assert.equal(wx.getStorageSync('huba_xiaoba_messages_v2'), undefined)
  wx.setStorageSync(firstKey, [{ content: '私密对话' }])
  wx.setStorageSync(AI_CONSENT_KEY, true)
  reconcileXiaoBaScope(wx, second)
  assert.equal(wx.getStorageSync(firstKey), undefined)
  assert.equal(wx.getStorageSync(secondKey), undefined)
  assert.equal(wx.getStorageSync(AI_CONSENT_KEY), undefined)
})

test('账号注销清理当前历史和 AI 同意', () => {
  const wx = fakeStorage()
  const scope = { user: { openid: 'a' }, space: { _id: 'one' }, partner: { openid: 'b' } }
  reconcileXiaoBaScope(wx, scope)
  wx.setStorageSync(historyKey(scope), [{ content: '旧空间' }])
  wx.setStorageSync(AI_CONSENT_KEY, true)
  clearXiaoBaSession(wx)
  assert.equal(wx.getStorageSync(historyKey(scope)), undefined)
  assert.equal(wx.getStorageSync(AI_CONSENT_KEY), undefined)
})
