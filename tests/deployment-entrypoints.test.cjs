const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { inspectDeploymentEntrypoints } = require('../scripts/deployment-entrypoints.cjs')

function withDeployableFunctions(names, assertion) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rainbow-cats-entrypoints-'))
  try {
    for (const name of names) {
      const functionRoot = path.join(root, name)
      fs.mkdirSync(functionRoot)
      fs.writeFileSync(path.join(functionRoot, 'index.js'), '')
    }
    assertion(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('deployment entrypoint check reports a missing secured api', () => {
  withDeployableFunctions([], root => {
    assert.deepEqual(inspectDeploymentEntrypoints(root), {
      missingApi: true,
      unexpectedEntrypoints: [],
    })
  })
})

test('deployment entrypoint check accepts only the secured api', () => {
  withDeployableFunctions(['api'], root => {
    assert.deepEqual(inspectDeploymentEntrypoints(root), {
      missingApi: false,
      unexpectedEntrypoints: [],
    })
  })
})

test('deployment entrypoint check reports each unexpected legacy function', () => {
  withDeployableFunctions(['api', 'legacy'], root => {
    assert.deepEqual(inspectDeploymentEntrypoints(root), {
      missingApi: false,
      unexpectedEntrypoints: ['legacy'],
    })
  })
})

test('deployable cloud function pins its server sdk instead of accepting an unreviewed upgrade', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/package.json'), 'utf8'))
  assert.match(packageJson.dependencies['wx-server-sdk'], /^\d+\.\d+\.\d+$/)
})

test('解除配对前确保邀请集合存在，以便安全撤销旧邀请', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/index.js'), 'utf8')
  assert.match(source, /unpair:\s*\[[^\]]*'PairInviteList'[^\]]*\]/)
})

test('public release checklist includes backup, permissions, indexes, environment and isolated testing gates', () => {
  const checklist = fs.readFileSync(path.join(__dirname, '../docs/DEPLOYMENT.md'), 'utf8')
  for (const phrase of ['数据库完整备份', '云存储完整备份', '仅管理端可读写', '复合索引', '独立测试环境', 'DEEPSEEK_API_KEY', 'security.msgSecCheck']) {
    assert.match(checklist, new RegExp(phrase))
  }
})

test('小八部署脚本使用临时干净目录且不会把本地密钥复制进函数代码包', () => {
  const script = fs.readFileSync(path.join(__dirname, '../scripts/configure-xiaoba.ps1'), 'utf8')
  assert.match(script, /DEEPSEEK_API_KEY/)
  assert.match(script, /staging/i)
  assert.match(script, /cloudbaserc\.json/)
  assert.doesNotMatch(script, /WriteAllText\(\$secretPath/)
  assert.doesNotMatch(script, /cloud functions deploy/)
  assert.doesNotMatch(script, /=\s*String\(/)
})
