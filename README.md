# 胡巴家长们

一个基于微信小程序与微信云开发的双人共享生活空间。两位用户可以通过邀请码建立空间，一起管理任务、积分、兑换、点菜、记录、愿望、家规和课表。

![胡巴家长们品牌图](miniprogram/images/brand/hero-home.jpg)

本项目基于 [Rainbow Cats](https://github.com/UxxHans/Rainbow-Cats-Personal-WeChat-MiniProgram) 的 MIT 版本改造，保留上游版权声明，并以 MIT 许可证继续开源。

## 主要能力

- 微信身份首次设置、一次性邀请码与双人空间生命周期。
- 按 `spaceId` 隔离的共享任务、积分商城、仓库、点菜、生活记录、愿望和家规。
- 共享主题图、个人头像、微信运动同步与订阅消息提醒。
- 可选课表：支持手动录入；OCR 不可用时不会影响手动方式。
- 可选小八助手：密钥只从云函数环境变量读取。
- 双阶段共同空间注销、分批清理与失败重试。

## 技术结构

```text
miniprogram/          微信小程序客户端
cloudfunctions/api/  唯一业务云函数与数据访问入口
scripts/             配置、自检和安全扫描脚本
tests/               Node.js 内置测试运行器测试
docs/                部署、配置和使用说明
```

客户端不直接读写云数据库。服务端根据调用者的 OpenID 查找所属空间，并忽略客户端伪造的 `spaceId`。

## 快速开始

需要 Node.js 20+、微信开发者工具、自己的小程序 AppID 和微信云开发环境。

```powershell
git clone https://github.com/lockhr/huba-home-miniprogram.git
cd huba-home-miniprogram
npm ci
npm ci --prefix miniprogram
npm ci --prefix cloudfunctions/api
node scripts/setup.cjs
```

然后：

1. 编辑本地文件 `miniprogram/config.local.json`，填写自己的 AppID 和云环境 ID。
2. 再次运行 `node scripts/setup.cjs`。
3. 用微信开发者工具打开仓库根目录，执行“工具 → 构建 npm”。
4. 在云开发控制台创建集合和索引，只上传 `cloudfunctions/api`。
5. 运行测试与公开检查：

```powershell
npm test
npm run check
npm run check:deployment
npm run check:public
```

完整步骤见 [部署指南](docs/DEPLOYMENT.md)；所有环境变量和降级行为见 [配置说明](docs/CONFIGURATION.md)。

## 可选功能

默认不配置任何额外服务时，核心空间功能仍可使用。

| 功能 | 开启条件 | 未开启时 |
| --- | --- | --- |
| 课表 | 云函数环境变量 `HUBA_FEATURE_SCHEDULE=true` | 隐藏入口 |
| 小八 | 存在 `DEEPSEEK_API_KEY`，且 `HUBA_PAUSE` 不含 `ai` | 隐藏入口 |
| 微信提醒 | 本地模板 ID 与部署配置有效 | 静默关闭 |
| 课表 OCR | 课表已开启，运行环境具备腾讯云 OCR 临时凭证 | 保留手动录入 |

空间记录中的 `featureFlags` 只能关闭这些能力，不能绕过部署配置开启它们。

## 已知限制

- 本项目不附带 AppID、云环境、AI 密钥、订阅消息模板或生产数据库。
- 微信能力、内容安全权限、云存储规则和审核要求需要部署者在自己的账号中配置并真机验证。
- 课表 OCR 依赖腾讯云 OCR 服务与临时凭证，不保证所有云函数运行环境都可直接使用。
- 仓库测试不能替代微信开发者工具编译、双手机配对和第三账号隔离测试。

## 安全与隐私

不要提交 `.env`、本地配置、OpenID、数据库导出、用户图片或任何密钥。可在被忽略的 `.local/private-patterns.txt` 中加入自己的私人标记，再运行 `npm run check`。

安全问题请按 [SECURITY.md](SECURITY.md) 使用 GitHub 私密漏洞报告，不要在公开 Issue 中粘贴真实用户数据或凭证。

发布时的 npm 审计结果与尚待上游修复的传递依赖风险见 [依赖安全状态](docs/DEPENDENCY_SECURITY.md)。

运行时素材的来源和许可见 [ASSETS.md](ASSETS.md)。

## 许可证

[MIT](LICENSE)。允许使用、复制、修改、合并、发布、分发、再许可和销售，但必须保留许可证中的版权与许可声明。
