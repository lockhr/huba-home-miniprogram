const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const aiClientPath = path.join(__dirname, '../cloudfunctions/api/ai-client.js')

test('小八系统提示按当前空间昵称生成且不包含私人姓名硬编码', () => {
  const { buildSystemPrompt } = require(aiClientPath)
  const prompt = buildSystemPrompt({
    callerName: '阿禾',
    partnerName: '小柚',
    memberNames: ['阿禾', '小柚'],
    appContext: '实时摘要',
  })

  assert.match(prompt, /阿禾/)
  assert.match(prompt, /小柚/)
  assert.match(prompt, /实时摘要/)
  assert.doesNotMatch(fs.readFileSync(aiClientPath, 'utf8'), /PRIVATE_MARKER_42/)
})

test('小八只从云函数环境变量读取密钥，不允许部署包内本地密钥兜底', () => {
  const source = fs.readFileSync(aiClientPath, 'utf8')
  assert.match(source, /process\.env\.DEEPSEEK_API_KEY/)
  assert.doesNotMatch(source, /ai\.secret\.local\.json/)
  assert.doesNotMatch(source, /readFileSync/)
})
