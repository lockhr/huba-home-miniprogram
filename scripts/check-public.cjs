const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const TEXT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.json', '.md', '.txt', '.wxml', '.wxss', '.wxs', '.ts', '.yml', '.yaml', '.toml'])
const SKIP_DIRECTORIES = new Set(['.git'])
const BANNED_DIRECTORIES = new Set(['node_modules', 'miniprogram_npm', '.local', '.superpowers', '.worktrees', 'output', 'Pics', 'migration', 'backups', 'exports', 'user-uploads'])
const BANNED_PATHS = [/^assets(?:\/|$)/i, /^docs\/(?:superpowers|releases)(?:\/|$)/i, /(?:^|\/)images\/memories(?:\/|$)/i]
const BANNED_FILENAMES = new Set([
  '.env', 'project.config.json', 'project.private.config.json',
  'config.local.json', 'config.runtime.js', 'ai.secret.local.json',
])
const SECRET_RULES = [
  { rule: '私钥内容', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { rule: '疑似 GitHub Token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { rule: '疑似 API 密钥', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { rule: '疑似腾讯云密钥', pattern: /\bAKID[A-Za-z0-9]{16,}\b/ },
  { rule: '疑似微信 OpenID', pattern: /\bo[A-Za-z0-9_-]{27}\b/ },
  { rule: '疑似硬编码凭证', pattern: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]{16,}['"]/i },
  { rule: '含凭证的 URL', pattern: /https?:\/\/[^\s/:]+:[^\s/@]+@/ },
  { rule: '本机绝对路径', pattern: /\b[A-Za-z]:\\(?:Users|Documents and Settings)\\/i },
]

function normalizePath(root, target) {
  return path.relative(root, target).replace(/\\/g, '/')
}

function gitVisibleFiles(root) {
  try {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\0').filter(Boolean).map(file => file.replace(/\\/g, '/'))
  } catch (error) {
    return null
  }
}

function scanPublicTree(root) {
  const absoluteRoot = path.resolve(root)
  const hits = []
  let scanned = 0
  const add = (file, rule, line = 0) => hits.push({ file, line, rule })

  const inspectFile = (target, relativePath) => {
    const basename = path.basename(relativePath)
    const environmentFile = /^\.env(?:\..+)?$/i.test(basename) && basename !== '.env.example'
    if (BANNED_FILENAMES.has(basename) || environmentFile || /\.local\./i.test(basename) || /(?:backup|migration|dump|export)/i.test(basename)) add(relativePath, '危险文件名')
    if (!TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase()) && !path.basename(relativePath).startsWith('.env')) return
    scanned += 1
    let source
    try { source = fs.readFileSync(target, 'utf8') } catch (error) { return }
    source.split(/\r?\n/).forEach((line, index) => {
      for (const candidate of SECRET_RULES) {
        if (candidate.pattern.test(line)) add(relativePath, candidate.rule, index + 1)
      }
    })
  }

  const visibleFiles = gitVisibleFiles(absoluteRoot)
  if (visibleFiles) {
    for (const relativePath of visibleFiles) {
      const parts = relativePath.split('/')
      if (parts.some(part => BANNED_DIRECTORIES.has(part)) || BANNED_PATHS.some(pattern => pattern.test(relativePath))) {
        add(relativePath, '禁止公开的目录')
        continue
      }
      inspectFile(path.join(absoluteRoot, ...parts), relativePath)
    }
    return { hits, scanned }
  }

  const visit = dir => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (error) { return }
    for (const entry of entries) {
      const target = path.join(dir, entry.name)
      const relativePath = normalizePath(absoluteRoot, target)
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        if (BANNED_DIRECTORIES.has(entry.name) || BANNED_PATHS.some(pattern => pattern.test(relativePath))) {
          add(`${relativePath}/`, '禁止公开的目录')
          continue
        }
        visit(target)
        continue
      }
      inspectFile(target, relativePath)
    }
  }

  visit(absoluteRoot)
  return { hits, scanned }
}

module.exports = { scanPublicTree }

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..'))
  const result = scanPublicTree(root)
  for (const hit of result.hits) console.log(`公开检查失败：${hit.file}${hit.line ? `:${hit.line}` : ''} —— ${hit.rule}`)
  console.log(`公开目录检查：${result.scanned} 个文本文件；命中：${result.hits.length}`)
  process.exitCode = result.hits.length ? 1 : 0
}
