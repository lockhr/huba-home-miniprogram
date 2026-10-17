const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { scanPublicTree } = require('../scripts/check-public.cjs')

test('公开目录扫描会拦截生成依赖和禁止公开的目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'huba-public-scan-'))
  fs.mkdirSync(path.join(root, 'miniprogram/miniprogram_npm'), { recursive: true })
  fs.writeFileSync(path.join(root, 'miniprogram/miniprogram_npm/index.js'), 'module.exports = {}')

  const result = scanPublicTree(root)
  assert.equal(result.hits.some(hit => hit.rule === '禁止公开的目录'), true)
})

test('公开目录扫描报告密钥类型但绝不回显密钥值', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'huba-public-secret-'))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  const fakeSecret = 'sk-' + 'a'.repeat(40)
  fs.writeFileSync(path.join(root, 'src/config.js'), `const token = "${fakeSecret}"`)

  const result = scanPublicTree(root)
  assert.equal(result.hits.some(hit => hit.rule === '疑似 API 密钥'), true)
  assert.equal(JSON.stringify(result).includes(fakeSecret), false)
})

test('公开目录扫描会拦截本机绝对路径和疑似微信 OpenID', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'huba-public-private-path-'))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  const fakeOpenid = `o${'A'.repeat(27)}`
  fs.writeFileSync(path.join(root, 'src/example.txt'), `C:\\Users\\Example\\private\n${fakeOpenid}`)

  const result = scanPublicTree(root)
  assert.equal(result.hits.some(hit => hit.rule === '本机绝对路径'), true)
  assert.equal(result.hits.some(hit => hit.rule === '疑似微信 OpenID'), true)
  assert.equal(JSON.stringify(result).includes(fakeOpenid), false)
})

test('Git 仓库只扫描已跟踪和未忽略文件，不误报安装后的依赖目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'huba-public-git-'))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules/example'), { recursive: true })
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n')
  fs.writeFileSync(path.join(root, 'src/index.js'), 'module.exports = {}\n')
  fs.writeFileSync(path.join(root, 'node_modules/example/index.js'), 'module.exports = {}\n')
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '.gitignore', 'src/index.js'], { cwd: root })

  const result = scanPublicTree(root)
  assert.equal(result.hits.length, 0)
  assert.equal(result.scanned, 1)
})

test('公开扫描拒绝迁移导出、备份目录和各类本地环境配置', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'huba-public-local-config-'))
  for (const dir of ['migration', 'backups', 'exports', 'miniprogram/images/memories']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
    fs.writeFileSync(path.join(root, dir, 'data.json'), '{}')
  }
  fs.writeFileSync(path.join(root, '.env.production'), 'EXAMPLE=placeholder')
  fs.writeFileSync(path.join(root, 'notification.config.local.json'), '{}')

  const result = scanPublicTree(root)
  assert.equal(result.hits.filter(hit => hit.rule === '禁止公开的目录').length, 4)
  assert.equal(result.hits.filter(hit => hit.rule === '危险文件名').length, 2)
})
