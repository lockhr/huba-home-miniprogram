const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/config.local.json'), 'utf8'))
const templateId = typeof source.subscribeTemplateId === 'string' ? source.subscribeTemplateId.trim() : ''
const requestedState = typeof source.subscribeMiniprogramState === 'string' ? source.subscribeMiniprogramState.trim() : 'trial'
const miniprogramState = ['developer', 'trial', 'formal'].includes(requestedState) ? requestedState : 'trial'
const defaults = { event: 'thing1', actor: 'name2', time: 'time3', detail: 'thing4' }
const fields = source.subscribeTemplateFields && typeof source.subscribeTemplateFields === 'object'
  ? { ...defaults, ...source.subscribeTemplateFields }
  : defaults
const notificationConfig = {
  enabled: Boolean(templateId),
  templateId,
  page: 'pages/MainPage/index',
  miniprogramState,
  lang: 'zh_CN',
  fields,
}
fs.writeFileSync(
  path.join(root, 'cloudfunctions/api/notification.config.local.json'),
  JSON.stringify(notificationConfig, null, 2) + '\n',
)
console.log(templateId ? '微信提醒云端配置已生成。' : '微信提醒代码已就绪，等待填写模板 ID。')
console.log('收件人不再来自配置文件，而是云端 UserList 里同一个 spaceId 的另一名成员。')
console.log('配置文件不会进入 Git；请勿在聊天或提交中公开任何人的身份标识。')
