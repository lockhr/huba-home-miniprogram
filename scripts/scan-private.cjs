// 私人内容扫描规则保存在被 Git 忽略的 .local/private-patterns.txt。
// 每行一个纯文本标记；空行和以 # 开头的注释会被忽略。
const fs = require('node:fs')
const path = require('node:path')

const TEXT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.json', '.md', '.wxml', '.wxss', '.wxs', '.ts', '.yml', '.yaml'])
const SKIP_DIRECTORIES = new Set(['node_modules', 'miniprogram_npm', '.git', '.local', '.miniprogram'])
const SECRET_FILENAMES = new Set(['ai.secret.local.json'])

function relative(root, target) {
  return path.relative(root, target).replace(/\\/g, '/')
}

function loadPrivateMarkers(root, rulesFile = path.join(root, '.local', 'private-patterns.txt')) {
  try {
    return fs.readFileSync(rulesFile, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
}

function scanPrivateContent(root, options = {}) {
  const targets = options.target
    ? [path.resolve(options.target)]
    : [path.join(root, 'miniprogram'), path.join(root, 'cloudfunctions', 'api')]
  const markers = loadPrivateMarkers(root, options.rulesFile)
  const hits = []
  let scanned = 0
  let paths = 0

  const visit = dir => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (error) { return }
    for (const entry of entries) {
      const file = path.join(dir, entry.name)
      const relativePath = relative(root, file)
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        paths += 1
        if (/^memories$/i.test(entry.name) && /^images$/i.test(path.basename(dir))) {
          hits.push({ file: `${relativePath}/`, line: 0, label: '私人照片目录' })
          continue
        }
        visit(file)
        continue
      }
      paths += 1
      if (SECRET_FILENAMES.has(entry.name)) {
        hits.push({ file: relativePath, line: 0, label: '云函数本地密钥文件' })
        continue
      }
      if (/images\/memories/i.test(relativePath)) hits.push({ file: relativePath, line: 0, label: '私人照片文件' })
      if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      scanned += 1
      let source
      try { source = fs.readFileSync(file, 'utf8') } catch (error) { continue }
      source.split(/\r?\n/).forEach((line, index) => {
        if (markers.some(marker => line.includes(marker))) {
          hits.push({ file: relativePath, line: index + 1, label: '本地私人标记' })
        }
      })
    }
  }

  for (const target of targets) visit(target)
  const seen = new Set()
  const unique = hits.filter(hit => {
    const key = `${hit.file}:${hit.line}:${hit.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { hits: unique, scanned, paths, target: targets.map(target => relative(root, target)).join(',') }
}

module.exports = { loadPrivateMarkers, scanPrivateContent }

if (require.main === module) {
  const root = path.resolve(__dirname, '..')
  const result = scanPrivateContent(root)
  for (const hit of result.hits) {
    console.log(`命中私人内容：${hit.file}${hit.line ? `:${hit.line}` : ''} —— ${hit.label}`)
  }
  console.log(`私人内容扫描：${result.scanned} 个文本文件、${result.paths} 条路径；命中：${result.hits.length}`)
  process.exitCode = result.hits.length ? 1 : 0
}
