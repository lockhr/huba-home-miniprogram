# 依赖安全状态

本页记录发布时无法通过简单升级消除的供应链风险，避免把“使用最新直接依赖”误写成“依赖树没有漏洞”。

## v0.1.0 审计结果

在 2026-10-16 使用 npm 官方仓库执行生产依赖审计：

- `miniprogram`：0 个已知漏洞。
- `cloudfunctions/api`：1 个中危、5 个高危，均来自 `wx-server-sdk@4.0.2` 的传递依赖，包括旧版 `axios`、`lodash.set` 和 `lodash.unset`。

项目按发布计划继续固定 `wx-server-sdk@4.0.2`。npm 当前给出的自动修复建议会把直接依赖降到 `2.5.3`，属于不符合本项目兼容策略的重大版本变更，因此没有执行 `npm audit fix --force`，也没有用未经云环境验证的 `overrides` 强行替换传递依赖。

部署者应在独立测试环境持续复查：

```powershell
npm audit --omit=dev --prefix miniprogram --registry=https://registry.npmjs.org
npm audit --omit=dev --prefix cloudfunctions/api --registry=https://registry.npmjs.org
```

当微信官方 SDK 发布包含修复的版本后，应先验证数据库事务、云存储、内容安全、订阅消息和注销清理流程，再更新固定版本与锁文件。
