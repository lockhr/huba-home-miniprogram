const test = require('node:test')
const assert = require('node:assert/strict')

const { runtimeCapabilitiesFrom } = require('../cloudfunctions/api/runtime-capabilities.js')

test('部署能力默认关闭，只有显式 true 才开启课表', () => {
  assert.deepEqual(runtimeCapabilitiesFrom({}), { schedule: false, xiaoba: false })
  assert.deepEqual(runtimeCapabilitiesFrom({ HUBA_FEATURE_SCHEDULE: 'true' }), { schedule: true, xiaoba: false })
  assert.equal(runtimeCapabilitiesFrom({ HUBA_FEATURE_SCHEDULE: ' TRUE ' }).schedule, true)
  assert.equal(runtimeCapabilitiesFrom({ HUBA_FEATURE_SCHEDULE: '1' }).schedule, false)
  assert.equal(runtimeCapabilitiesFrom({ HUBA_FEATURE_SCHEDULE: 'yes' }).schedule, false)
})

test('小八需要 API Key，且 HUBA_PAUSE=ai 优先关闭能力', () => {
  assert.equal(runtimeCapabilitiesFrom({ DEEPSEEK_API_KEY: 'test-key' }).xiaoba, true)
  assert.equal(runtimeCapabilitiesFrom({ DEEPSEEK_API_KEY: '   ' }).xiaoba, false)
  assert.equal(runtimeCapabilitiesFrom({ DEEPSEEK_API_KEY: 'test-key', HUBA_PAUSE: 'image, AI' }).xiaoba, false)
})

test('解析部署能力不会修改传入的环境对象', () => {
  const env = { HUBA_FEATURE_SCHEDULE: 'true', DEEPSEEK_API_KEY: 'test-key', HUBA_PAUSE: '' }
  const snapshot = { ...env }
  runtimeCapabilitiesFrom(env)
  assert.deepEqual(env, snapshot)
})
