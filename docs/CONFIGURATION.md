# 配置说明

项目把配置分成两类：本地小程序配置，以及云函数环境变量。真实值都不应提交到 Git。

## 本地小程序配置

复制配置模板并生成运行文件：

```powershell
npm install
npm install --prefix miniprogram
npm install --prefix cloudfunctions/api
node scripts/setup.cjs
```

编辑被忽略的 `miniprogram/config.local.json`：

- `appId`：自己的微信小程序 AppID。
- `envId`：自己的微信云开发环境 ID。
- `subscribeTemplateId`：可选；留空时微信提醒保持关闭。
- `subscribeMiniprogramState`：提醒跳转版本，可填 `developer`、`trial` 或 `formal`。
- `subscribeTemplateFields`：提醒模板字段名，必须与你申请的模板一致。

修改后再次运行 `node scripts/setup.cjs`。它会生成被忽略的 `miniprogram/config.runtime.js` 和 `project.config.json`。

## 云函数部署能力

这些变量在微信云开发控制台的 `api` 云函数环境变量中设置，不写入任何源码文件：

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `HUBA_FEATURE_SCHEDULE` | 关闭 | 只有值为 `true` 时向正常空间开放课表 |
| `DEEPSEEK_API_KEY` | 未配置 | 存在非空值时才开放小八 |
| `DEEPSEEK_MODEL` | 代码默认值 | 可选，指定兼容的模型名 |
| `HUBA_PAUSE` | 空 | 逗号分隔；`ai` 关闭小八，`image` 暂停带图写入 |

空间记录中的 `featureFlags` 只能进一步关闭已部署的功能，不能绕过部署级开关。`getBootstrap.features` 会把最终结果下发给客户端。

## 可选能力降级

- 不配置 `DEEPSEEK_API_KEY`：隐藏小八入口，直接调用返回 `XIAOBA_UNAVAILABLE`。
- 不设置 `HUBA_FEATURE_SCHEDULE=true`：隐藏课表入口，直接调用返回 `SCHEDULE_UNAVAILABLE`。
- 课表已开启但 OCR 临时凭证或服务不可用：截图识别返回 `SCHEDULE_OCR_UNAVAILABLE`，仍可手动录入课表。
- 提醒模板 ID 留空：不发送微信提醒，任务、商城、记录等核心功能不受影响。

## 本地私人内容规则

可新建 `.local/private-patterns.txt`，每行写一个只属于你部署环境的纯文本标记，例如昵称片段、纪念日或 OpenID 前缀。执行 `npm run check` 时会扫描源码，但报告只显示文件和规则名，不回显标记值。该文件已被 Git 忽略。
