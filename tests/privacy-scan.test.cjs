const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { scanPrivateContent } = require('../scripts/scan-private.cjs')

test('私人内容扫描从被忽略的本地规则文件读取标记', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'huba-private-scan-'))
  fs.mkdirSync(path.join(root, 'miniprogram'), { recursive: true })
  fs.mkdirSync(path.join(root, 'cloudfunctions/api'), { recursive: true })
  fs.mkdirSync(path.join(root, '.local'), { recursive: true })
  fs.writeFileSync(path.join(root, '.local/private-patterns.txt'), '# 只在本机保存\nPRIVATE_MARKER_42\n')
  fs.writeFileSync(path.join(root, 'miniprogram/app.js'), 'module.exports = {}')
  fs.writeFileSync(path.join(root, 'cloudfunctions/api/prompt.js'), 'const privateValue = "PRIVATE_MARKER_42"')

  const result = scanPrivateContent(root)
  assert.equal(result.hits.some(hit => hit.file === 'cloudfunctions/api/prompt.js' && hit.label === '本地私人标记'), true)
  assert.equal(JSON.stringify(result).includes('PRIVATE_MARKER_42'), false)
})

test('云函数部署目录出现本地 AI 密钥文件时扫描失败且不读取密钥值', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'huba-secret-scan-'))
  fs.mkdirSync(path.join(root, 'miniprogram'), { recursive: true })
  fs.mkdirSync(path.join(root, 'cloudfunctions/api'), { recursive: true })
  fs.writeFileSync(path.join(root, 'cloudfunctions/api/ai.secret.local.json'), '{"apiKey":"do-not-print"}')

  const result = scanPrivateContent(root)
  const hit = result.hits.find(item => item.label === '云函数本地密钥文件')
  assert.equal(hit.file, 'cloudfunctions/api/ai.secret.local.json')
  assert.equal(JSON.stringify(result).includes('do-not-print'), false)
})

test('正常生成的小程序本地配置不被误认为云函数密钥文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'huba-private-runtime-'))
  fs.mkdirSync(path.join(root, 'miniprogram'), { recursive: true })
  fs.writeFileSync(path.join(root, 'miniprogram/config.local.json'), '{"appId":"","envId":""}')
  fs.writeFileSync(path.join(root, 'miniprogram/config.runtime.js'), 'module.exports = { appId: "", envId: "" }')
  const result = scanPrivateContent(root)
  assert.equal(result.hits.length, 0)
})
