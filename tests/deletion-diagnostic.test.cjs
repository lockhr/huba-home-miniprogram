const test = require('node:test')
const assert = require('node:assert/strict')

const { publicDeletionDiagnostic } = require('../cloudfunctions/api/shared.js')

test('注销诊断只显示阶段和安全的云端错误信息，不泄露账号或密钥', () => {
  const exampleOpenId = 'o' + 'A'.repeat(27)
  const error = Object.assign(new Error(`write failed for ${exampleOpenId}, key sk-example-value`), {
    name: 'CloudBaseError',
    errCode: '-502001',
    diagnosticStage: 'WRITE_SPACE',
  })
  const message = publicDeletionDiagnostic(error)
  assert.match(message, /WRITE_SPACE/)
  assert.match(message, /-502001/)
  assert.doesNotMatch(message, new RegExp(exampleOpenId))
  assert.doesNotMatch(message, /sk-example-value/)
  assert.doesNotMatch(message, /write failed/)
})

test('分批清理诊断可以只返回阶段和类别，不携带原始异常正文', () => {
  const error = Object.assign(new Error('private note and cloud://env/couples/space/photo.jpg'), {
    code: 'FILE_DELETE_FAILED', diagnosticStage: 'DELETE_CLOUD_FILE',
  })
  const message = publicDeletionDiagnostic(error, { includeDetail: false })
  assert.match(message, /DELETE_CLOUD_FILE\/FILE_DELETE_FAILED/)
  assert.doesNotMatch(message, /private note|cloud:\/\//)
})

test('错误对象伪造的代码和阶段也不会变成公开诊断内容', () => {
  const message = publicDeletionDiagnostic({ name: 'SecretName', code: 'privateToken123', diagnosticStage: 'PRIVATE_STAGE' })
  assert.equal(message, '服务器异常（UNKNOWN_STAGE/UNKNOWN/Error）')
})
