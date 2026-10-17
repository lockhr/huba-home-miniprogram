const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const configPath = path.join(root, 'miniprogram/config.local.json')
if (!fs.existsSync(configPath)) fs.copyFileSync(path.join(root, 'miniprogram/config.example.json'), configPath)
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
// 小程序运行时读取标准 JS 模块；JSON 仅作为方便编辑的本地输入。
const runtime = {}
for (const key of ['appId', 'envId', 'subscribeTemplateId']) {
  if (typeof config[key] !== 'string') throw new Error('配置字段必须是字符串：' + key)
  runtime[key] = config[key].trim()
}
fs.writeFileSync(path.join(root, 'miniprogram/config.runtime.js'),
  '// 由 scripts/setup.cjs 生成，请编辑 config.local.json 后重新运行脚本。\nmodule.exports = ' + JSON.stringify(runtime, null, 2) + '\n')
const projectPath = path.join(root, 'project.config.json')
const source = fs.existsSync(projectPath) ? projectPath : path.join(root, 'project.config.example.json')
const project = JSON.parse(fs.readFileSync(source, 'utf8'))
project.appid = config.appId || 'touristappid'
project.projectname = 'HubaHome'
project.miniprogramRoot = 'miniprogram/'
project.cloudfunctionRoot = 'cloudfunctions/'
fs.writeFileSync(projectPath, JSON.stringify(project, null, 2) + '\n')
console.log('本地配置已准备；已有配置会保留。')
console.log('AppID：' + (config.appId ? '已填写' : '待填写（游客配置不能使用云开发）'))
console.log('云环境：' + (config.envId ? '已填写' : '待填写'))
