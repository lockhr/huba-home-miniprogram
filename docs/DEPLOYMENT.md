# 微信云开发部署指南

本文面向全新部署。不要把已有生产环境的数据导出、用户图片或本地配置复制进公开仓库。

## 1. 准备独立环境

1. 在微信公众平台注册自己的小程序并取得 AppID。
2. 在微信开发者工具中创建一个独立测试环境，先不要连接正式用户数据。
3. 对已有环境升级前，先做一次数据库完整备份和云存储完整备份，并验证备份可恢复。
4. 按 [配置说明](CONFIGURATION.md)准备本地配置并运行 `node scripts/setup.cjs`。

## 2. 安装与自检

需要 Node.js 20 或更高版本：

```powershell
npm ci
npm ci --prefix miniprogram
npm ci --prefix cloudfunctions/api
npm test
npm run check
npm run check:deployment
npm run check:public
```

`miniprogram/miniprogram_npm/` 是构建产物，不进入 Git。打开微信开发者工具后，选择“工具 → 构建 npm”生成它。

## 3. 数据库集合与权限

建议先在控制台创建以下集合；代码也会在首次请求时尝试补建当前动作所需集合：

```text
UserList           CoupleSpaceList    PairInviteList
SpaceFileList      MissionList        MarketList
StorageList        HouseRuleList      MenuList
DinnerOrderList    MemoryPostList     WishList
ScheduleList
```

所有集合都设置为“仅管理端可读写”。客户端不应直连数据库，业务读写统一经过 `api` 云函数。

至少准备这些索引；若云开发控制台提示具体查询缺索引，以控制台生成的字段顺序为准：

- `UserList`：`_openid`；`spaceId + memberStatus` 复合索引。
- `PairInviteList`：`tokenDigest`；`spaceId + status` 复合索引。
- `SpaceFileList`：`fileId`；`spaceId + fileId` 复合索引。
- 各业务集合：`spaceId`；按时间展示的集合增加 `spaceId + date` 复合索引。

云存储需要允许小程序用户上传，同时确保读取和删除规则符合你的隐私政策。不要设置成与数据库相同的“一刀切”规则后未经真机验证就上线。

## 4. 云函数权限与环境变量

只上传 `cloudfunctions/api`。不要把整个 `cloudfunctions` 目录当成一个函数，也不要上传本地 `node_modules`。

在 `api` 云函数中：

1. 运行环境选择受支持的 Node.js 20 版本。
2. 安装依赖；`wx-server-sdk` 固定为 `4.0.2`。
3. 授予调用 `security.msgSecCheck` 与 `security.imgSecCheck` 的内容安全权限。
4. 按需配置 `HUBA_FEATURE_SCHEDULE`、`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL` 和 `HUBA_PAUSE`。
5. 重新上传并部署云函数。

不配置 AI、提醒或 OCR 时，核心双人空间功能仍可运行。详细降级行为见 [配置说明](CONFIGURATION.md)。

## 5. 微信提醒

提醒是可选功能。申请订阅消息模板后，把模板 ID 和字段填入本地配置，运行：

```powershell
node scripts/setup.cjs
node scripts/prepare-notifications.cjs
```

生成的 `cloudfunctions/api/notification.config.local.json` 被 Git 忽略。上传函数时需要包含这份部署专用配置；模板为空时提醒保持关闭。

## 6. 验收清单

在独立测试环境完成以下验证，再考虑体验版或正式发布：

- 微信开发者工具编译无错误，构建 npm 后组件可加载。
- 新账号首次进入、保存昵称、创建空间、复制邀请码、另一账号加入均正常。
- 两个账号共同完成任务、商城、记录、点菜、提醒登记与退出登录流程。
- 第三个测试账号不能看到其他空间的数据。
- 功能开关关闭时，入口隐藏且直接调用返回稳定的不可用错误。
- 手动录入课表在 OCR 不可用时仍正常。
- 注销共同空间需要连续确认两次，并能在清理中断后继续。
- GitHub Actions 通过，MIT 被识别，仓库秘密扫描无警报，README 图片可显示。

一旦检查发现真实凭证、用户数据或私人图片，先轮换凭证并停止发布，再从干净源码重新生成仓库。不要用后续删除提交掩盖已经公开的历史。
