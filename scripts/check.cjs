// 只检查本地文件，不连接云端，不打印账号值。
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { inspectDeploymentEntrypoints } = require('./deployment-entrypoints.cjs')
const { scanPrivateContent } = require('./scan-private.cjs')
const root = path.resolve(__dirname, '..')
let failed = 0
let checked = 0
const deploymentMode = process.argv.includes('--deployment')
let deploymentSafetyErrors = 0
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'miniprogram_npm', '.git', '.local', 'migration'].includes(entry.name)) continue
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) { walk(file); continue }
    if (!/\.(?:js|cjs|json)$/.test(file)) continue
    try {
      const source = fs.readFileSync(file, 'utf8')
      if (file.endsWith('.json')) JSON.parse(source)
      else new vm.Script(source, { filename: path.relative(root, file) })
      checked++
    } catch (error) {
      console.error('格式检查失败：' + path.relative(root, file))
      failed++
    }
  }
}
walk(root)
const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'))
for (const page of app.pages) {
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
    if (!fs.existsSync(path.join(root, 'miniprogram', page + ext))) {
      console.error('页面文件缺失：' + page + ext)
      failed++
    }
  }
}
if (deploymentMode) {
  const cloudFunctionsRoot = path.join(root, 'cloudfunctions')
  const { missingApi, unexpectedEntrypoints } = inspectDeploymentEntrypoints(cloudFunctionsRoot)
  if (missingApi) {
    console.error('云函数部署安全检查失败：缺少唯一允许部署的入口：cloudfunctions/api/index.js')
    deploymentSafetyErrors++
  }
  for (const name of unexpectedEntrypoints) {
    console.error(`云函数部署安全检查失败：只允许部署 cloudfunctions/api，发现其他可部署入口：cloudfunctions/${name}`)
    deploymentSafetyErrors++
  }
}
console.log(`语法/JSON 检查：${checked} 个文件；注册页面：${app.pages.length} 个；错误：${failed}`)
let pending = true
try {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/config.local.json'), 'utf8'))
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
  const runtime = require(path.join(root, 'miniprogram/config.runtime.js'))
  const checks = {
    '运行配置已同步': ['appId', 'envId', 'subscribeTemplateId'].every(key => typeof config[key] === 'string' && runtime[key] === config[key].trim()),
    'AppID 格式': typeof config.appId === 'string' && /^wx[0-9a-f]{16}$/i.test(config.appId),
    '开发者工具 AppID 已同步': !!config.appId && project.appid === config.appId,
    '云环境 ID': typeof config.envId === 'string' && !!config.envId.trim(),
    '微信提醒模板': typeof config.subscribeTemplateId === 'string' && !!config.subscribeTemplateId.trim(),
  }
  for (const [label, ready] of Object.entries(checks)) console.log(`${label}：${ready ? '已填写/通过' : '待配置'}`)
  pending = Object.values(checks).some(ready => !ready)
} catch (error) { console.log('个人配置尚未就绪，请运行 node scripts/setup.cjs') }
const privateScan = scanPrivateContent(root)
if (privateScan.hits.length) {
  for (const hit of privateScan.hits) {
    console.error(`私人内容扫描失败：${hit.file}${hit.line ? ':' + hit.line : ''} 命中「${hit.label}」`)
    failed++
  }
}
console.log(`私人内容扫描：${privateScan.scanned} 个文件，其中 ${privateScan.paths} 个路径；命中私人内容：${privateScan.hits.length}`)
console.log('上述检查不代表已完成微信编译、云端部署或双手机验证。')
process.exitCode = failed || deploymentSafetyErrors ? 1 : deploymentMode && pending ? 2 : 0
