const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const spaceUtils = require('../miniprogram/utils/space.js')

// 页面唯一的身份来源是服务端下发的 bootstrap。测试脚手架必须照同一个形状注入，
// 否则页面会用旧模型（两个写死的 openid）跑出「假通过」。
const SELF = { openid: 'test-a', displayName: '小禾', avatarKey: 'cat', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true, credit: 12, canEditMood: true, canSyncSteps: true }
const PARTNER = { openid: 'test-b', displayName: '小柚', avatarKey: 'rabbit', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true, credit: 34, canEditMood: false, canSyncSteps: false }
const SPACE = { _id: 'test-space', name: '测试空间', anniversaryDate: '', status: 'active' }
const FEATURES = { schedule: false, dinner: true, records: true, xiaoba: true }

function loadPage(name, callFunction, configured = true, previewMode = false, overrides = {}) {
  let page
  const calls = []
  const apiCalls = []
  const navigations = []
  const globalData = {
    currentUser: { ...SELF, ...(overrides.currentUser || {}) },
    partner: overrides.partner === null ? null : { ...PARTNER, ...(overrides.partner || {}) },
    space: { ...SPACE, ...(overrides.space || {}) },
    features: { ...FEATURES, ...(overrides.features || {}) },
    spaceState: 'ready',
    maxCredit: 520,
    collectionUserList: 'UserList', collectionMissionList: 'MissionList',
    collectionMarketList: 'MarketList', collectionStorageList: 'StorageList',
  }
  const app = {
    globalData,
    previewMode,
    bootstrap: { state: 'ready', user: globalData.currentUser, partner: globalData.partner, space: globalData.space, features: globalData.features },
    ensureConfigured: () => configured,
    ensureWritable: () => !previewMode,
    exitPreview() { this.previewMode = false; return true },
    isMine: openid => openid === globalData.currentUser.openid,
    nameOf: openid => spaceUtils.nameOfMember(openid, globalData.currentUser, globalData.partner),
    myName: () => globalData.currentUser.displayName,
    partnerName: () => (globalData.partner && globalData.partner.displayName) || '对方',
    loadBootstrap: async () => {
      const bootstrap = await app.api('getBootstrap')
      if (!spaceUtils.isBootstrap(bootstrap)) {
        const error = new Error('云端还没有支持情侣空间，请先上传最新版云函数')
        error.code = 'BOOTSTRAP_UNAVAILABLE'
        throw error
      }
      app.bootstrap = bootstrap
      Object.assign(globalData, {
        spaceState: bootstrap.state,
        currentUser: bootstrap.user || null,
        partner: bootstrap.partner || null,
        space: bootstrap.space || null,
        features: bootstrap.features || globalData.features,
      })
      return bootstrap
    },
    renewPartnerReminderSilently: async () => null,
    addPartnerReminder: async () => ({ ...await app.api('registerPartnerReminder'), status: 'accept' }),
    api: async (action, data) => { apiCalls.push({ action, data }); return callFunction({ action, data }) },
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages', name, 'index.js'), 'utf8'), {
    Page: value => { page = value },
    getApp: () => app,
    require: filename => {
      if (filename === '../../utils/share.js') return require('../miniprogram/utils/share.js')
      if (filename === '../../utils/anniversary.js') return require('../miniprogram/utils/anniversary.js')
      if (filename === '../../utils/space.js') return require('../miniprogram/utils/space.js')
      if (filename === '../../utils/appearance.js') return require('../miniprogram/utils/appearance.js')
      if (filename === '../../utils/mission-calendar.js') return require('../miniprogram/utils/mission-calendar.js')
      if (filename === '../../utils/list-feedback.js') {
        const module = { exports: {} }
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/utils/list-feedback.js'), 'utf8'), {
          module, wx: { showLoading() {}, hideLoading() {}, showToast() {}, showModal({ success }) { success({ confirm: true }) } },
        })
        return module.exports
      }
      if (filename === '../../utils/subscriptions.js') return {
        getPartnerReminderStatus: async () => ({ ready: false, text: '测试提醒', action: '开启' }),
        requestPartnerReminder: async () => ({ status: 'accept', ready: true, text: '测试提醒已开启', action: '已开启' }),
      }
      assert.fail(`unexpected page dependency: ${filename}`)
    },
    wx: {
      cloud: { callFunction: args => { calls.push(args.name); return callFunction(args) } },
      showToast() {}, showModal() {}, hideKeyboard() {}, navigateBack() {}, getSystemInfo({ success }) { success({ windowWidth: 390, windowHeight: 844 }) },
      reLaunch: value => navigations.push(value.url),
    },
    console: { warn() {}, error() {} }, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {}
  })
  page.setData = patch => Object.assign(page.data, patch)
  return { page, app, calls, apiCalls, navigations }
}

function loadApp(config, callFunction = async () => ({ result: { ok: true, data: null } }), requestAutoPartnerReminder = async () => null, reviewDemo = null) {
  let app
  let initialized = 0
  const toasts = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/app.js'), 'utf8'), {
    require: filename => {
      if (filename === './config.runtime.js') return config
      if (filename === './utils/subscriptions.js') return { requestAutoPartnerReminder, requestPartnerReminder: requestAutoPartnerReminder }
      if (filename === './utils/space-preview.js') return require('../miniprogram/utils/space-preview.js')
      if (filename === './utils/space.js') return require('../miniprogram/utils/space.js')
      if (filename === './utils/appearance.js') return require('../miniprogram/utils/appearance.js')
      if (filename === './utils/xiaoba-storage.js') return require('../miniprogram/utils/xiaoba-storage.js')
      if (filename === './utils/review-demo.js') {
        if (reviewDemo) return { createReviewDemo: () => reviewDemo }
        return require('../miniprogram/utils/review-demo.js')
      }
      assert.fail(`unexpected app dependency: ${filename}`)
    },
    App: value => { app = value },
    wx: { cloud: { init() { initialized++ }, callFunction, CloudID: value => ({ cloudID: value }) }, showToast: value => toasts.push(value) },
  })
  app.onLaunch()
  return { app, initialized, toasts }
}

test('only the secured api cloud function remains deployable', () => {
  const cloudFunctionsRoot = path.join(__dirname, '../cloudfunctions')
  const deployableFunctions = fs.readdirSync(cloudFunctionsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(cloudFunctionsRoot, entry.name, 'index.js')))
    .map(entry => entry.name)
    .sort()

  assert.deepEqual(deployableFunctions, ['api'])
})

test('application starts without attempting cloud initialization for blank configuration', () => {
  const { app, initialized } = loadApp({ appId: '', envId: '' })
  assert.equal(initialized, 0)
  assert.equal(app.ensureConfigured(), false)
  assert.equal(app.globalData.collectionMissionList, 'MissionList')
})

// 旧用例断言的是「公共配置里写着两个人的名字」。多情侣公测之后，
// 公共配置只保留基础设施字段，人的信息一律来自服务端 UserList。
test('public configuration keeps infrastructure keys only', () => {
  const root = path.join(__dirname, '../miniprogram')
  for (const name of ['config.example.json', 'config.local.json', 'config.runtime.js']) {
    const file = path.join(root, name)
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    for (const key of ['userA', 'userB', 'openidA', 'openidB']) {
      assert.equal(text.includes(key), false, `${name} 仍保留已移除的身份配置：${key}`)
    }
  }
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.example.json'), 'utf8'))
  assert.deepEqual(Object.keys(config).sort(), [
    'appId', 'envId', 'subscribeMiniprogramState', 'subscribeTemplateFields', 'subscribeTemplateId',
  ])
})

test('application initializes cloud once the environment is configured', () => {
  const { app, initialized } = loadApp({ appId: 'test-app', envId: 'test-env' })
  assert.equal(initialized, 1)
  assert.equal(app.ensureConfigured(), true)
})

// 「两个 openid 是否相同」这件事已经不存在：身份由服务端按 spaceId 判定。
// 取而代之要锁定的是——客户端不再保留任何写死的身份。
test('the client keeps no hardcoded identity of its own', () => {
  const { app } = loadApp({ appId: 'test-app', envId: 'test-env' })
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/app.js'), 'utf8')
  assert.doesNotMatch(source, /_openidA|_openidB|openidA|openidB|userA|userB/)
  assert.equal(app.globalData.spaceState, 'unpaired')
  assert.equal(app.globalData.currentUser, null)
  assert.equal(app.globalData.partner, null)
})

test('app api unwraps secured cloud responses', async () => {
  let request
  const { app } = loadApp(
    { appId: 'test-app', envId: 'test-env' },
    async value => { request = value; return { result: { ok: true, data: { credit: 7 } } } },
  )
  assert.deepEqual(await app.api('getSession'), { credit: 7 })
  assert.equal(request.name, 'api')
  assert.equal(request.data.action, 'getSession')
})

test('app api sends WeRun CloudID at the cloud-function top level', async () => {
  let request
  const { app } = loadApp(
    { appId: 'test-app', envId: 'test-env' },
    async value => { request = value; return { result: { ok: true, data: { steps: 3210 } } } },
  )
  await app.api('syncWeRun', {}, { weRunData: 'cloud-id' })
  assert.deepEqual(request.data.weRunData, { cloudID: 'cloud-id' })
  assert.equal(request.data.data.weRunData, undefined)
})

test('app api turns business failures into readable errors', async () => {
  const { app } = loadApp(
    { appId: 'test-app', envId: 'test-env' },
    async () => ({ result: { ok: false, error: 'FORBIDDEN', message: '只能操作自己的记录' } }),
  )
  await assert.rejects(() => app.api('deleteElement'), error => error.code === 'FORBIDDEN' && error.message === '只能操作自己的记录')
})

test('app rejects an old bootstrap that lacks explicit profile completion state', async () => {
  const { app } = loadApp(
    { appId: 'test-app', envId: 'test-env' },
    async () => ({
      result: {
        ok: true,
        data: { state: 'unpaired', user: { displayName: '我', avatarKey: 'cat' }, partner: null, space: null },
      },
    }),
  )

  await assert.rejects(
    () => app.loadBootstrap(),
    error => error.code === 'BOOTSTRAP_UNAVAILABLE' && /最新版云函数/.test(error.message),
  )
})

test('app rejects bootstrap that still infers onboarding from profile alone', async () => {
  const { app } = loadApp(
    { appId: 'test-app', envId: 'test-env' },
    async () => ({
      result: {
        ok: true,
        data: { state: 'unpaired', user: { displayName: '旧昵称', avatarKey: 'cat', profileComplete: true }, partner: null, space: null },
      },
    }),
  )

  await assert.rejects(
    () => app.loadBootstrap(),
    error => error.code === 'BOOTSTRAP_UNAVAILABLE' && /最新版云函数/.test(error.message),
  )
})

test('unconfigured home makes no cloud requests', async () => {
  const { page, calls } = loadPage('MainPage', async () => ({ result: { data: [] } }), false)
  await page.onShow()
  assert.equal(calls.length, 0)
  assert.ok(page.data.setupMessage)
})

test('未配对的空间直达首页时回欢迎页重新分流', async () => {
  const { page, navigations } = loadPage('MainPage', async ({ action }) => {
    if (action === 'getBootstrap') return { state: 'unpaired', user: { displayName: '小禾', avatarKey: 'cat', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true }, partner: null, space: null }
    return null
  })
  await page.onShow()
  assert.deepEqual(navigations, ['/pages/Welcome/index'])
  assert.equal(page.data.setupMessage, '')
})

test('首页按 bootstrap 渲染两位成员的昵称与积分', async () => {
  const { page } = loadPage('MainPage', async ({ action }) => {
    if (action === 'getBootstrap') {
      return { state: 'ready', user: { ...SELF, credit: 12 }, partner: { ...PARTNER, credit: 34 }, space: { ...SPACE }, features: { ...FEATURES } }
    }
    if (action === 'getHouseRules') return { callerOpenid: 'test-a', items: [] }
    return null
  })
  await page.onShow()
  assert.equal(page.data.mine.name, '小禾')
  assert.equal(page.data.mine.credit, 12)
  assert.equal(page.data.partner.name, '小柚')
  assert.equal(page.data.partner.credit, 34)
  assert.equal(page.data.partnerName, '小柚')
  assert.equal(page.data.setupMessage, '')
})

test('failed cloud connection returns to the retryable welcome page', async () => {
  const { page, navigations } = loadPage('MainPage', async () => { throw Error('test network failure') })
  await page.onShow()
  assert.deepEqual(navigations, ['/pages/Welcome/index'])
  assert.equal(page.data.setupMessage, '')
})

test('saving a task stays on the secured api path', async () => {
  const { page, calls } = loadPage('MissionAdd', async () => ({}))
  let saved = false
  page.saveMission = async () => { saved = true }
  await page.handleTap()
  assert.equal(saved, true)
  assert.equal(calls.includes('information'), false)
})

test('欢迎页示例与创建按钮在不同手机上都用弹性布局垂直居中文案', () => {
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/Welcome/index.wxml'), 'utf8')
  const style = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/Welcome/index.wxss'), 'utf8')
  assert.match(markup, /class="welcome-primary" bindtap="browseDemo"[^>]*><text>先看看示例空间<\/text><\/button>/)
  assert.match(markup, /class="welcome-secondary" bindtap="startOnboarding"[^>]*><text>创建或加入自己的空间<\/text><\/button>/)
  assert.match(style, /\.welcome-primary\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/)
  assert.match(style, /\.welcome-secondary\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/)
  assert.doesNotMatch(style, /\.welcome-primary\s*\{[^}]*line-height:\s*94rpx/)
})

test('任务保存连点只提交一次，并在等待期间显示提交状态', async () => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const { page, apiCalls } = loadPage('MissionAdd', async () => pending)
  page.setData({ title: '打扫房间', desc: '一起收拾', credit: 5 })
  const first = page.handleTap()
  const second = page.handleTap()
  assert.equal(apiCalls.filter(call => call.action === 'createElement').length, 1)
  assert.equal(page.data.saving, true)
  finish({ _id: 'one' })
  await Promise.all([first, second])
})

test('任务表单把可选计划日期发给服务端，清除日期后仍可保存', async () => {
  const { page, apiCalls } = loadPage('MissionAdd', async () => ({ _id: 'one' }))
  page.setData({ title: '一起散步', desc: '', credit: 12 })
  page.setPlanDate({ detail: { value: '2026-10-01' } })
  await page.saveMission()
  assert.equal(apiCalls.find(call => call.action === 'createElement').data.planDate, '2026-10-01')
  page.setData({ saving: false })
  page.clearPlanDate()
  assert.equal(page.data.planDate, '')
})

test('任务月历选择日期只筛当日任务，全部视图保留无日期旧任务', async () => {
  const rows = [
    { _id: 'old', _openid: 'test-a', title: '旧任务', credit: 5, available: true, date: '2026-09-01' },
    { _id: 'planned', _openid: 'test-b', title: '散步', credit: 5, available: true, planDate: '2026-10-01', date: '2026-09-20' },
  ]
  const { page } = loadPage('Mission', async ({ action }) => action === 'getList' ? rows : {})
  await page.onShow()
  assert.equal(page.data.unfinishedMissions.length, 2)
  page.selectCalendarDay({ currentTarget: { dataset: { date: '2026-10-01' } } })
  assert.deepEqual(Array.from(page.data.unfinishedMissions, item => item._id), ['planned'])
  page.showAllMissions()
  assert.equal(page.data.unfinishedMissions.length, 2)
})

test('任务详情展示可选计划日期，旧任务仍可不显示该行', () => {
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/MissionDetail/index.wxml'), 'utf8')
  assert.match(markup, /wx:if="\{\{mission\.planDate\}\}"[^>]*>/)
  assert.match(markup, /计划日期/)
})

test('商品保存失败后重试同一请求，修改内容后改用新请求标识', async () => {
  const calls = []
  const { page } = loadPage('MarketAdd', async ({ action, data }) => {
    if (action !== 'createElement') return {}
    calls.push(data)
    if (calls.length <= 2) throw new Error('response lost')
    return { _id: 'one' }
  })
  page.setData({ title: '奶茶券', desc: '一杯', credit: 5 })
  await page.saveItem()
  await page.saveItem()
  assert.equal(calls.length, 2)
  assert.equal(typeof calls[0].requestId, 'string')
  assert.equal(calls[0].requestId, calls[1].requestId)
  page.onTitleInput({ detail: { value: '电影券' } })
  await page.saveItem()
  assert.notEqual(calls[2].requestId, calls[1].requestId)
})

// 示例空间必须由用户主动进入，页面上要写明「不会保存」并能继续真实流程。
test('主动进入的示例空间在首页明确标注只读并提供创建入口', async () => {
  const { page, app, navigations } = loadPage('MainPage', async ({ action }) => {
    if (action === 'getBootstrap') {
      return { state: 'ready', user: { ...SELF }, partner: { ...PARTNER }, space: { ...SPACE }, features: { ...FEATURES } }
    }
    if (action === 'getHouseRules') return { callerOpenid: 'test-a', items: [] }
    return null
  }, true, true)

  await page.onShow()

  assert.equal(page.data.previewMode, true)
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/MainPage/index.wxml'), 'utf8')
  assert.match(markup, /示例空间/)
  assert.match(markup, /不会保存/)
  assert.match(markup, /创建或加入/)

  page.leavePreview()
  assert.equal(app.previewMode, false)
  assert.deepEqual(navigations, ['/pages/Welcome/index'])
})

// 旧的「请求失败就自动切成本地示例」已经删掉：只读预览只能由用户主动进入。
test('云端失败不自动降级，只读预览必须由用户主动进入', async () => {
  let cloudCalls = 0
  const { app } = loadApp(
    { appId: 'test-app', envId: 'test-env' },
    async () => {
      cloudCalls++
      return { result: { ok: false, error: 'UNAUTHORIZED', message: '当前微信账号未获得访问权限' } }
    },
  )

  await assert.rejects(() => app.api('getUsers'), error => error.code === 'UNAUTHORIZED')
  assert.equal(app.previewMode, false, '失败后不能自己切进预览')
  assert.equal(cloudCalls, 1)

  app.enterPreview()
  assert.equal(app.previewMode, true)
  assert.equal(app.globalData.spaceState, 'ready')
  assert.equal(app.globalData.currentUser.displayName, '阿禾')
  assert.equal(app.globalData.partner.displayName, '小柚')
  assert.ok((await app.api('getUsers')).length > 0)
  assert.equal(cloudCalls, 1, '预览模式下的读取不允许再打云端')
})

test('只读预览下的写入不发往云端', async () => {
  let cloudCalls = 0
  const { app } = loadApp(
    { appId: 'test-app', envId: 'test-env' },
    async () => { cloudCalls++; return { result: { ok: true, data: {} } } },
  )
  app.enterPreview()

  await assert.rejects(
    () => app.api('createMemoryPost', { content: '不会保存' }),
    error => error.code === 'REVIEW_READ_ONLY' && /只读/.test(error.message),
  )
  assert.equal(cloudCalls, 0)
})

test('云存储路径统一带空间前缀，没有空间时明确报错', async () => {
  const { app } = loadApp({ appId: 'test-app', envId: 'test-env' })
  await assert.rejects(() => app.spaceUploadPath('records'), error => error.code === 'NO_SPACE')

  const { app: ready } = loadApp(
    { appId: 'test-app', envId: 'test-env' },
    async request => {
      const action = request && request.data ? request.data.action : ''
      if (action !== 'getBootstrap') return { result: { ok: true, data: null } }
      return {
        result: {
          ok: true,
          data: { state: 'ready', user: { ...SELF }, partner: { ...PARTNER }, space: { _id: 'space-ab', name: '我们的小屋' }, features: { ...FEATURES } },
        },
      }
    },
  )
  assert.match(await ready.spaceUploadPath('records'), /^couples\/space-ab\/records\/\d+-[a-z0-9]+\.jpg$/)
  assert.match(await ready.spaceUploadPath('dishes'), /^couples\/space-ab\/dishes\//)

  for (const page of ['Records', 'DishAdd']) {
    const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages', page, 'index.js'), 'utf8')
    assert.match(source, /spaceUploadPath\(/, `${page} 上传路径没有带空间前缀`)
    assert.doesNotMatch(source, /cloudPath: `(records|dishes)\//, `${page} 还在用没有空间前缀的旧路径`)
  }
})

test('review mode blocks privacy prompts before pages invoke WeChat capabilities', () => {
  const { app, toasts } = loadApp({ appId: 'test-app', envId: 'test-env' })
  app.enterPreview()
  assert.equal(app.ensureWritable(), false)
  assert.match(toasts[0].title, /只读/)

  const root = path.join(__dirname, '../miniprogram/pages')
  const home = fs.readFileSync(path.join(root, 'MainPage/index.js'), 'utf8')
  const records = fs.readFileSync(path.join(root, 'Records/index.js'), 'utf8')
  const dishAdd = fs.readFileSync(path.join(root, 'DishAdd/index.js'), 'utf8')
  assert.match(home, /async syncWeRun[\s\S]*?ensureWritable\(\)[\s\S]*?await authorizeWeRun\(\)/)
  assert.match(records, /choosePostImage\(\)[\s\S]*?ensureWritable\(\)[\s\S]*?wx\.chooseMedia/)
  assert.match(dishAdd, /chooseImage\(\)[\s\S]*?ensureWritable\(\)[\s\S]*?wx\.chooseMedia/)
})

test('app silently records a reminder credit after WeChat auto-accepts renewal', async () => {
  const actions = []
  const { app } = loadApp(
    { appId: 'test-app', envId: 'test-env' },
    async request => {
      actions.push(request.data.action)
      return { result: { ok: true, data: { reminderCredits: 2 } } }
    },
    async () => ({ status: 'accept', ready: true }),
  )

  const result = await app.renewPartnerReminderSilently()

  assert.equal(result.reminderCredits, 2)
  assert.deepEqual(actions, ['registerPartnerReminder'])
})

test('home lets each person subscribe to the next partner activity notification', () => {
  const root = path.join(__dirname, '../miniprogram')
  const markup = fs.readFileSync(path.join(root, 'pages/MainPage/index.wxml'), 'utf8')
  const source = fs.readFileSync(path.join(root, 'utils/subscriptions.js'), 'utf8')
  const cloudConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/config.json'), 'utf8'))

  assert.match(markup, /把想念送到微信/)
  assert.match(markup, /bindtap="enablePartnerReminder"/)
  assert.match(source, /wx\.requestSubscribeMessage/)
  assert.ok(cloudConfig.permissions.openapi.includes('subscribeMessage.send'))
})

test('home records a separate one-time reminder grant for the current person', async () => {
  const { page, apiCalls } = loadPage('MainPage', async ({ action }) => {
    if (action === 'registerPartnerReminder') return { reminderReady: true, reminderCredits: 3 }
    if (action === 'getUsers') return [
      { openid: 'test-a', canEditMood: true, reminderCredits: 3 },
      { openid: 'test-b', canEditMood: false, reminderCredits: 2 },
    ]
    return null
  })

  await page.enablePartnerReminder()

  assert.deepEqual(apiCalls.map(call => call.action), ['registerPartnerReminder', 'getUsers'])
  assert.equal(page.data.reminderCredits, 3)
  assert.equal(page.data.reminderAdded, true)
  assert.equal(page.data.reminderBusy, false)
})

test('confirming a mission uses one atomic backend operation', async () => {
  const { page, apiCalls } = loadPage('Mission', async () => ({ credit: 5 }))
  const mission = { _id: 'mission-1', _openid: 'test-a', credit: 5, available: true }
  page.data.allMissions = [mission]
  page.data.unfinishedMissions = [mission]
  await page.finishMission({ currentTarget: { dataset: { index: 0 } } })
  assert.deepEqual(apiCalls.map(call => call.action), ['completeMission'])
  assert.equal(page.data.unfinishedMissions.length, 0)
  assert.equal(page.data.finishedMissions.length, 1)
  assert.equal(page.data.finishedMissions[0].mine, true)
  assert.equal(page.data.finishedMissions[0].ownerName, '小禾')
})

test('buying an item uses one atomic backend operation', async () => {
  const { page, apiCalls } = loadPage('Market', async () => ({ credit: 8 }))
  page.data.credit = 10
  const item = { _id: 'item-1', _openid: 'test-a', credit: 2, available: true }
  page.data.allItems = [item]
  page.data.unboughtItems = [item]
  await page.buyItem({ currentTarget: { dataset: { index: 0 } } })
  assert.deepEqual(apiCalls.map(call => call.action), ['buyItem'])
  assert.equal(page.data.credit, 8)
  assert.equal(page.data.unboughtItems.length, 0)
  assert.equal(page.data.boughtItems.length, 1)
  assert.equal(page.data.boughtItems[0].mine, true)
  assert.equal(page.data.boughtItems[0].ownerName, '小禾')
})

test('business pages call only the secured api cloud function through app.api', () => {
  const pagesRoot = path.join(__dirname, '../miniprogram/pages')
  const files = fs.readdirSync(pagesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(pagesRoot, entry.name, 'index.js'))
    .filter(file => fs.existsSync(file))
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    assert.equal(source.includes('wx.cloud.callFunction'), false, `${path.basename(path.dirname(file))} 仍在绕过安全 API`)
  }
})

test('every page exposes the standard friend share card', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'))
  for (const pagePath of config.pages) {
    const source = fs.readFileSync(path.join(__dirname, '../miniprogram', `${pagePath}.js`), 'utf8')
    assert.match(source, /onShareAppMessage\s*\(/, `${pagePath} 缺少好友分享入口`)
  }

  const { getShareMessage } = require('../miniprogram/utils/share.js')
  assert.deepEqual(getShareMessage(), {
    title: '胡巴家长们｜一起把每一天变得更好',
    path: '/pages/MainPage/index',
    imageUrl: '/images/share-cover.jpg',
  })
})

test('main pages reserve an explicit adaptive header while home keeps live balance bindings', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const config = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'))
  assert.equal(config.window.navigationBarTitleText, '胡巴家长们')

  for (const pageName of ['MainPage', 'Mission', 'Market', 'Account']) {
    const markup = fs.readFileSync(path.join(miniProgramRoot, 'pages', pageName, 'index.wxml'), 'utf8')
    assert.doesNotMatch(markup, /<brand-header/, `${pageName} 不应再依赖真机占位不稳定的组件`)
    assert.match(markup, /<page-heading title="胡巴家长们"/, `${pageName} 缺少顶部品牌标题`)
  }

  const globalStyles = fs.readFileSync(path.join(miniProgramRoot, 'app.wxss'), 'utf8')
  assert.match(globalStyles, /\.page-shell\s*\{[^}]*padding-top:\s*0;/s)
  const header = fs.readFileSync(path.join(miniProgramRoot, 'components/page-heading/index.wxml'), 'utf8')
  assert.match(header, /height:\s*\{\{height\}\}px/)

  const homeMarkup = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.wxml'), 'utf8')
  assert.match(homeMarkup, /\{\{mine\.credit\}\}/)
  assert.match(homeMarkup, /\{\{partner\.credit\}\}/)
  assert.doesNotMatch(homeMarkup, />\s*(155|123)\s*</)
})

test('main pages use a rounded custom tab bar and labelled create actions', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const config = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'))
  assert.equal(config.tabBar.custom, true)

  const tabMarkup = fs.readFileSync(path.join(miniProgramRoot, 'custom-tab-bar/index.wxml'), 'utf8')
  assert.match(tabMarkup, /class="tabbar-frame"/)

  for (const pageName of ['Mission', 'Market']) {
    const markup = fs.readFileSync(path.join(miniProgramRoot, 'pages', pageName, 'index.wxml'), 'utf8')
    assert.match(markup, /<view class="create-action-capsule"/)
    assert.match(markup, /create-action-label/)
  }
})

test('home exposes the shared Huba house-rules journal above the score board', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const config = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'))
  assert.ok(config.pages.includes('pages/HouseRules/index'))

  const homeMarkup = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.wxml'), 'utf8')
  const rulesPosition = homeMarkup.indexOf('胡巴家规')
  const scorePosition = homeMarkup.indexOf('积分榜')
  const welcomePosition = homeMarkup.indexOf('欢迎回来')
  assert.ok(rulesPosition > -1 && rulesPosition < scorePosition && scorePosition < welcomePosition)
  assert.match(homeMarkup, /bindtap="openHouseRules"/)

  const homeSource = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.js'), 'utf8')
  const rulesSource = fs.readFileSync(path.join(miniProgramRoot, 'pages/HouseRules/index.js'), 'utf8')
  const apiEntrySource = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/index.js'), 'utf8')
  assert.match(homeSource, /app\.api\(['"]getHouseRules['"]\)/)
  assert.match(rulesSource, /app\.api\(['"]createHouseRule['"]/)
  assert.match(rulesSource, /app\.api\(['"]deleteHouseRule['"]/)
  assert.doesNotMatch(rulesSource, /wx\.cloud/)
  assert.match(apiEntrySource, /ensureCollection/)
  assert.match(apiEntrySource, /Promise\.all\(requiredCollections\.map\(ensureCollection\)\)/)
  assert.match(apiEntrySource, /HouseRuleList/)
})

// 纪念日由空间配置提供，没配置就整块隐藏。
test('纪念日来自空间配置，没有配置时首页隐藏该模块', () => {
  const { getAnniversaryDay, formatAnniversaryDate } = require('../miniprogram/utils/anniversary.js')
  assert.equal(getAnniversaryDay('', new Date(2026, 8, 10)), null)
  assert.equal(getAnniversaryDay('不是日期', new Date(2026, 8, 10)), null)
  assert.equal(getAnniversaryDay('2026-09-10', new Date(2026, 8, 10)), 1)
  assert.equal(getAnniversaryDay('2026-05-20', new Date(2026, 8, 16)), 120)
  assert.equal(formatAnniversaryDate('2026-05-20'), '2026.05.20')
  assert.equal(formatAnniversaryDate(''), '')

  const homeMarkup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/MainPage/index.wxml'), 'utf8')
  const anniversaryPosition = homeMarkup.indexOf('纪念日')
  const rulesPosition = homeMarkup.indexOf('胡巴家规')
  assert.ok(anniversaryPosition > -1 && anniversaryPosition < rulesPosition)
  assert.match(homeMarkup, /wx:if="\{\{anniversaryDay\}\}"/)
  assert.doesNotMatch(homeMarkup, /PRIVATE_MARKER_42/)
})

test('home uses a varied dashboard layout with selectable shared moods', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const homeMarkup = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.wxml'), 'utf8')
  const homeSource = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.js'), 'utf8')

  assert.match(homeMarkup, /class="mood-grid"/)
  assert.match(homeMarkup, /bindtap="chooseMood"/)
  assert.match(homeMarkup, /appearance\.anniversary/)
  assert.match(homeMarkup, /appearance\.rules/)
  assert.match(homeMarkup, /appearance\.welcome/)
  assert.match(homeSource, /showActionSheet/)
  assert.match(homeSource, /app\.api\(['"]updateMood['"]/)
})

test('home provides private per-user WeRun synchronization', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const homeMarkup = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.wxml'), 'utf8')
  const homeSource = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.js'), 'utf8')
  const appSource = fs.readFileSync(path.join(miniProgramRoot, 'app.js'), 'utf8')
  const apiEntrySource = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/index.js'), 'utf8')

  assert.match(homeMarkup, /微信运动/)
  assert.match(homeMarkup, /bindtap="syncWeRun"/)
  assert.match(homeSource, /scope\.werun/)
  assert.match(homeSource, /getWeRunData/)
  assert.match(homeSource, /app\.api\(['"]syncWeRun['"]/)
  assert.match(appSource, /wx\.cloud\.CloudID/)
  assert.match(apiEntrySource, /event\.weRunData/)
})

test('首页首图默认使用公共品牌素材、支持共享装扮，并且仍然能进入点菜', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const homeMarkup = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.wxml'), 'utf8')
  const homeSource = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.js'), 'utf8')
  const appearanceSource = fs.readFileSync(path.join(miniProgramRoot, 'utils/appearance.js'), 'utf8')
  assert.match(homeMarkup, /appearance\.hero/)
  assert.match(appearanceSource, /images\/brand\/hero-home\.jpg/)
  assert.doesNotMatch(homeMarkup, /images\/memories\//)
  assert.match(homeMarkup, /今晚点菜/)
  assert.match(homeSource, /pages\/Dinner\/index/)
})

test('首页底部空间设置使用统一的空间与安全功能卡', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const markup = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.wxml'), 'utf8')
  const styles = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.wxss'), 'utf8')
  const source = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.js'), 'utf8')

  assert.match(markup, /class="space-entry-icon"/)
  assert.match(markup, /class="space-entry-kicker"/)
  assert.equal((markup.match(/class="space-entry-chip"/g) || []).length, 3)
  assert.match(markup, /使用说明/)
  assert.match(markup, /\{\{spaceName/)
  assert.match(styles, /\.space-entry-card\s*\{[^}]*display:\s*flex;[^}]*border-radius:\s*28rpx;[^}]*box-shadow:/s)
  assert.match(styles, /\.space-entry-slider/)
  assert.match(source, /spaceName:\s*''/)
  assert.match(source, /spaceName:\s*space\.name\s*\|\|/)
})

test('dinner pages provide shared dish selection and compressed image upload', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const config = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'))
  assert.ok(config.pages.includes('pages/Dinner/index'))
  assert.ok(config.pages.includes('pages/DishAdd/index'))

  const dinnerSource = fs.readFileSync(path.join(miniProgramRoot, 'pages/Dinner/index.js'), 'utf8')
  const addSource = fs.readFileSync(path.join(miniProgramRoot, 'pages/DishAdd/index.js'), 'utf8')
  assert.match(dinnerSource, /\.api\(['"]toggleDish['"]/)
  assert.match(dinnerSource, /\.api\(['"]completeDinnerOrder['"]/)
  assert.match(addSource, /chooseMedia/)
  assert.match(addSource, /sizeType:\s*\[['"]compressed['"]\]/)
  assert.match(addSource, /cloud\.uploadFile/)
  assert.match(addSource, /\.api\(['"]createDish['"]/)
})

test('dinner order dock keeps the selected count on one responsive line', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const dinnerMarkup = fs.readFileSync(path.join(miniProgramRoot, 'pages/Dinner/index.wxml'), 'utf8')
  const dinnerStyles = fs.readFileSync(path.join(miniProgramRoot, 'pages/Dinner/index.wxss'), 'utf8')
  assert.match(dinnerMarkup, /class="dock-count-line"/)
  assert.match(dinnerMarkup, /class="dock-count"/)
  assert.match(dinnerStyles, /\.dock-count-line\s*\{[^}]*white-space:\s*nowrap;/s)
  assert.doesNotMatch(dinnerStyles, /\.dock-copy view>text:last-child/)
})

test('课表只在服务端开放时显示，并按空间成员区分', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const config = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'))
  assert.ok(config.pages.includes('pages/Schedule/index'))

  const homeMarkup = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.wxml'), 'utf8')
  const homeSource = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.js'), 'utf8')
  const scheduleMarkup = fs.readFileSync(path.join(miniProgramRoot, 'pages/Schedule/index.wxml'), 'utf8')
  const scheduleSource = fs.readFileSync(path.join(miniProgramRoot, 'pages/Schedule/index.js'), 'utf8')

  assert.match(homeMarkup, /双人课表/)
  assert.match(homeMarkup, /wx:if="\{\{hasSchedule\}\}" class="section-block schedule-feature" bindtap="openSchedule"/)
  assert.match(homeSource, /pages\/Schedule\/index/)
  assert.match(scheduleMarkup, /wx:for="\{\{members\}\}"/)
  assert.match(scheduleMarkup, /\{\{item\.name\}\}的课表/)
  assert.match(scheduleSource, /api\(['"]getSchedule['"]\)/)
  assert.doesNotMatch(scheduleSource, /PRIVATE_MARKER_42/)
})

test('packaged raster assets stay below the mini program image budget', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif'])
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(target)
    return imageExtensions.has(path.extname(entry.name).toLowerCase()) ? [target] : []
  })
  const totalBytes = walk(miniProgramRoot).reduce((sum, file) => sum + fs.statSync(file).size, 0)
  assert.equal(
    fs.existsSync(path.join(miniProgramRoot, 'images/memories')),
    false,
    '私人照片必须已经移出代码包',
  )
  assert.ok(totalBytes < 1_250_000, `图片资源过大：${totalBytes} bytes`)
})

test('item detail keeps the packaged brand artwork fully visible', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const markup = fs.readFileSync(path.join(miniProgramRoot, 'pages/ItemDetail/index.wxml'), 'utf8')
  const styles = fs.readFileSync(path.join(miniProgramRoot, 'pages/ItemDetail/index.wxss'), 'utf8')

  assert.match(markup, /images\/brand\/mascot-pair\.png/)
  assert.match(markup, /class="item-memory-photo"[^>]*mode="aspectFit"/)
  assert.match(styles, /\.item-memory-photo\s*\{[^}]*object-position:\s*center;/s)
})

test('mission editor keeps the full garden portrait visible', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const markup = fs.readFileSync(path.join(miniProgramRoot, 'pages/MissionAdd/index.wxml'), 'utf8')
  const styles = fs.readFileSync(path.join(miniProgramRoot, 'pages/MissionAdd/index.wxss'), 'utf8')

  assert.match(markup, /class="mission-memory-photo"[^>]*mode="aspectFit"/)
  assert.match(styles, /\.mission-memory-frame\s*\{/)
})

test('literal search symbols do not throw and deleting stays deleted after clearing search', async () => {
  for (const name of ['Market', 'Account']) {
    const { page } = loadPage(name, async () => ({}))
    page.setData({ allItems: [{ _id: 'one', _openid: 'test-a', title: '礼物[限定]', available: true }, { _id: 'two', _openid: 'test-a', title: '晚餐', available: true }], search: '[' })
    page.filterItem()
    const key = name === 'Market' ? 'unboughtItems' : 'unusedItems'
    assert.equal(page.data[key].length, 1)
    await page.slideButtonTapUpper({ detail: { index: 2 }, currentTarget: { dataset: { index: 0 } } })
    page.clearSearch()
    assert.equal(page.data[key].length, 1)
    assert.equal(page.data[key][0]._id, 'two')
  }
})

test('saving freezes dish and record photo/category choices', () => {
  for (const name of ['DishAdd', 'Records']) {
    const { page } = loadPage(name, async () => ({}))
    page.setData({ saving: true, category: 'meat', imageTempPath: 'dish.jpg', wishIcon: '💗', wishImagePath: 'wish.jpg', postImagePath: 'post.jpg' })
    if (name === 'DishAdd') {
      page.selectCategory({ currentTarget: { dataset: { category: 'soup' } } })
      page.removeImage()
      assert.equal(page.data.category, 'meat')
      assert.equal(page.data.imageTempPath, 'dish.jpg')
    } else {
      page.selectWishIcon({ currentTarget: { dataset: { icon: '📚' } } })
      page.removeWishImage()
      page.removePostImage()
      assert.equal(page.data.wishIcon, '💗')
      assert.equal(page.data.wishImagePath, 'wish.jpg')
      assert.equal(page.data.postImagePath, 'post.jpg')
    }
  }
})

test('record editors hide the custom tab bar and restore it on close or leaving page', () => {
  const { page } = loadPage('Records', async () => ({}))
  const tab = { data: {}, setData(patch) { Object.assign(this.data, patch) } }
  page.getTabBar = () => tab
  page.openCreator()
  assert.equal(tab.data.hidden, true)
  page.closePostEditor()
  assert.equal(tab.data.hidden, false)
  page.setData({ activeSection: 'wish' })
  page.openCreator()
  assert.equal(tab.data.hidden, true)
  page.closeWishEditor()
  assert.equal(tab.data.hidden, false)
  page.openCreator()
  page.onHide()
  assert.equal(tab.data.hidden, false)
})

test('task and shop editors disable every native form control while saving', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  for (const pageName of ['MissionAdd', 'MarketAdd']) {
    const markup = fs.readFileSync(path.join(miniProgramRoot, `pages/${pageName}/index.wxml`), 'utf8')
    for (const tag of ['picker', 'input', 'textarea', 'slider']) {
      assert.match(markup, new RegExp(`<${tag}\\b[^>]*disabled="\\{\\{saving\\}\\}"`), `${pageName} ${tag} should be disabled while saving`)
    }
  }
})

test('records tab combines shared world posts and wish checklist', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const config = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'))
  assert.ok(config.pages.includes('pages/Records/index'))
  assert.equal(config.tabBar.list[4].text, '记录')

  const tabSource = fs.readFileSync(path.join(miniProgramRoot, 'custom-tab-bar/index.js'), 'utf8')
  const markup = fs.readFileSync(path.join(miniProgramRoot, 'pages/Records/index.wxml'), 'utf8')
  const source = fs.readFileSync(path.join(miniProgramRoot, 'pages/Records/index.js'), 'utf8')
  assert.match(tabSource, /pages\/Records\/index/)
  assert.match(markup, /我们的世界/)
  assert.match(markup, /愿望清单/)
  assert.match(markup, /bindtap="toggleLike"/)
  assert.match(markup, /(bind|catch)tap="toggleWish"/)
  assert.match(source, /\.api\(['"]getRecords['"]/)
  assert.match(source, /\.api\(['"]createMemoryPost['"]/)
  assert.match(source, /\.api\(['"]createWish['"]/)
})

test('公共课表工具只保留星期与作息规则，不含任何具体课程', () => {
  const schedulePath = path.join(__dirname, '../miniprogram/utils/schedule.js')
  delete require.cache[require.resolve(schedulePath)]
  const schedule = require(schedulePath)

  assert.deepEqual(Object.keys(schedule).sort(), ['DAY_LABELS', 'PERIODS', 'SEASON_RULE'])
  assert.equal(schedule.DAY_LABELS.length, 7)
  assert.match(schedule.SEASON_RULE, /当前执行夏令时/)

  const source = fs.readFileSync(schedulePath, 'utf8')
  for (const course of ['联盟链原理与实践', '当代中国经济', '国际金融', '习近平经济思想概论', '区块链与金融创新']) {
    assert.equal(source.includes(course), false, `公共课表工具仍写死了课程：${course}`)
  }

  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/Schedule/index.wxml'), 'utf8')
  assert.match(markup, /当前执行夏令时/)
})

// 原来的两份用例断言的是「代码包里写死了谁上什么课」。私人课表迁进云端之后，
// 要锁定的是相反的行为：页面只从 getSchedule 读，并且按 spaceId 隔离。
test('课表页只从云端按空间读取，不在代码包里硬编码课程', () => {
  const pages = path.join(__dirname, '../miniprogram/pages/Schedule')
  const source = fs.readFileSync(path.join(pages, 'index.js'), 'utf8')
  const markup = fs.readFileSync(path.join(pages, 'index.wxml'), 'utf8')

  assert.match(source, /api\(['"]getSchedule['"]\)/)
  assert.match(source, /byOwner\[member\.openid\]/)
  assert.match(source, /globalData\.features\.schedule/)
  assert.doesNotMatch(source, /SCHEDULES/)
  assert.doesNotMatch(markup, /images\/memories\//)
})

test('records photos stay readable and editor actions remain reachable above the keyboard', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const markup = fs.readFileSync(path.join(miniProgramRoot, 'pages/Records/index.wxml'), 'utf8')
  const styles = fs.readFileSync(path.join(miniProgramRoot, 'pages/Records/index.wxss'), 'utf8')
  const source = fs.readFileSync(path.join(miniProgramRoot, 'pages/Records/index.js'), 'utf8')

  assert.match(markup, /src="\{\{appearance\.records\}\}"/)
  assert.match(markup, /class="hero-memory-photo"[^>]*appearanceDisplayCustom\.records[^>]*aspectFill[^>]*aspectFit/)
  assert.match(markup, /class="post-image"[^>]*mode="aspectFit"/)
  assert.match(markup, /scroll-view[^>]*class="editor-scroll"/)
  assert.match(markup, /class="sheet-actions"/)
  assert.match(markup, /bindkeyboardheightchange="handleKeyboardHeightChange"/)
  assert.match(styles, /\.editor-sheet\s*\{[^}]*max-height:/s)
  assert.match(styles, /\.editor-scroll\s*\{[^}]*min-height:\s*0/s)
  assert.match(source, /handleKeyboardHeightChange/)
})

test('record creation sheets live outside the animated page shell', () => {
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/Records/index.wxml'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/Records/index.wxss'), 'utf8')

  const pageShellEnd = markup.search(/<\/view>\r?\n\r?\n<view wx:if="\{\{showPostEditor\}\}"/)
  assert.ok(pageShellEnd > 0, 'post editor should be a viewport-level sibling after the page shell')
  assert.match(markup.slice(pageShellEnd), /<view wx:if="\{\{showWishEditor\}\}" class="editor-mask"/)
  assert.match(styles, /\.editor-mask\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*2000;/s)
})

test('XiaoBa is a global assistant with a dedicated polished chat route', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const config = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'))
  assert.ok(config.pages.includes('pages/XiaoBa/index'))
  assert.equal(config.usingComponents['xiaoba-orb'], '/components/xiaoba-orb/index')

  const pageFiles = fs.readdirSync(path.join(miniProgramRoot, 'pages'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'XiaoBa')
    .map(entry => path.join(miniProgramRoot, 'pages', entry.name, 'index.wxml'))
    .filter(file => fs.existsSync(file))
  const onboardingPages = ['Setup', 'Invite', 'SpaceSetting']
  for (const name of onboardingPages) {
    const file = path.join(miniProgramRoot, 'pages', name, 'index.wxml')
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /<xiaoba-orb\s*\/>/, `${name} 不应显示小八入口`)
  }
  for (const name of ['MainPage', 'Mission', 'Records']) {
    const file = path.join(miniProgramRoot, 'pages', name, 'index.wxml')
    assert.match(fs.readFileSync(file, 'utf8'), /<xiaoba-orb\s*\/>/, `${name} 缺少小八入口`)
  }

  const markup = fs.readFileSync(path.join(miniProgramRoot, 'pages/XiaoBa/index.wxml'), 'utf8')
  const source = fs.readFileSync(path.join(miniProgramRoot, 'pages/XiaoBa/index.js'), 'utf8')
  assert.match(markup, /小八/)
  assert.match(markup, /scroll-view/)
  assert.match(markup, /bindtap="sendMessage"/)
  assert.match(markup, /quickPrompts/)
  assert.match(source, /\.api\(['"]askXiaoBa['"]/)
  assert.match(source, /ensureAiConsent/)
  assert.match(source, /aiConsent:\s*true/)
  assert.match(markup, /第三方 AI/)
  const launcherSource = fs.readFileSync(path.join(miniProgramRoot, 'components/xiaoba-orb/index.js'), 'utf8')
  const launcherMarkup = fs.readFileSync(path.join(miniProgramRoot, 'components/xiaoba-orb/index.wxml'), 'utf8')
  assert.match(launcherSource, /canShowXiaoBa/)
  assert.match(launcherMarkup, /wx:if="\{\{visible\}\}"/)
  assert.match(source, /canShowXiaoBa/)
  assert.match(source, /loadBootstrap/)
  assert.doesNotMatch(launcherSource, /if\s*\(\s*!bootstrap\s*&&/, '入口每次显示都要刷新，不能优先信旧缓存')
  assert.doesNotMatch(source, /if\s*\(\s*!bootstrap\s*\)/, '小八直达页必须强制刷新状态')

  const frontendSource = pageFiles.concat([
    path.join(miniProgramRoot, 'pages/XiaoBa/index.js'),
    path.join(miniProgramRoot, 'app.js'),
  ]).map(file => fs.readFileSync(file, 'utf8')).join('\n')
  assert.doesNotMatch(frontendSource, /sk-[a-zA-Z0-9]{20,}/)

  const aiClientSource = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/ai-client.js'), 'utf8')
  assert.match(aiClientSource, /PROVIDER_TIMEOUT_MS\s*=\s*2[0-4]\d{2}/, '小八应在云函数硬超时前返回可重试提示')
})

test('XiaoBa cleans provider markdown before showing replies', () => {
  const { cleanAssistantText } = require('../miniprogram/utils/ai-text.js')
  const raw = '## 今晚计划\n\n**第一步**：散步\n- 带水\n- 慢慢走\n`记得早点回来`'
  const clean = cleanAssistantText(raw)

  assert.equal(clean, '今晚计划\n\n第一步：散步\n· 带水\n· 慢慢走\n记得早点回来')
  assert.doesNotMatch(clean, /[#*_`]/)
})

test('小程序内使用说明覆盖公测完整流程并从首页和空间设置进入', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const config = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'))
  assert.ok(config.pages.includes('pages/Help/index'))

  const helpMarkup = fs.readFileSync(path.join(miniProgramRoot, 'pages/Help/index.wxml'), 'utf8')
  for (const phrase of ['当前微信身份', '创建空间', '邀请码', '一个微信账号', '小八', '离开空间', '注销共同空间', '注销个人账号', '两次确认', '隐私', '常见问题']) {
    assert.match(helpMarkup, new RegExp(phrase), `使用说明缺少：${phrase}`)
  }

  const mainSource = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.js'), 'utf8')
  const mainMarkup = fs.readFileSync(path.join(miniProgramRoot, 'pages/MainPage/index.wxml'), 'utf8')
  const settingsSource = fs.readFileSync(path.join(miniProgramRoot, 'pages/SpaceSetting/index.js'), 'utf8')
  const settingsMarkup = fs.readFileSync(path.join(miniProgramRoot, 'pages/SpaceSetting/index.wxml'), 'utf8')
  for (const source of [mainSource, settingsSource]) assert.match(source, /pages\/Help\/index/)
  for (const markup of [mainMarkup, settingsMarkup]) assert.match(markup, /使用说明/)
})

test('可转发的体验版说明与小程序内规则保持一致', () => {
  const guide = fs.readFileSync(path.join(__dirname, '../docs/USER_GUIDE.md'), 'utf8')
  for (const phrase of ['一个微信账号', '复制邀请码', '离开当前空间', '注销共同空间', '注销个人账号', '连续确认两次', '撤销', '小八', '数据隔离']) {
    assert.match(guide, new RegExp(phrase), `体验版说明缺少：${phrase}`)
  }
})

test('小八的上下文只带公共信息，身份与课表由服务端按空间生成', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const contextPath = path.join(miniProgramRoot, 'utils/xiaoba-context.js')
  assert.equal(fs.existsSync(contextPath), true)
  const { buildXiaoBaContext } = require(contextPath)
  const context = buildXiaoBaContext({
    now: new Date('2026-09-10T12:00:00+08:00'),
    currentUser: { displayName: '小禾' },
    partner: { displayName: '小柚' },
  })
  assert.match(context, /当前提问者：小禾/)
  assert.match(context, /“对方”指小柚/)
  assert.match(context, /当前执行夏令时/)
  assert.doesNotMatch(context, /PRIVATE_MARKER_42/)
  assert.doesNotMatch(context, /完整课表/)

  const pageSource = fs.readFileSync(path.join(miniProgramRoot, 'pages/XiaoBa/index.js'), 'utf8')
  assert.match(pageSource, /buildXiaoBaContext/)
  assert.doesNotMatch(pageSource, /identity\s*:/)
  assert.doesNotMatch(pageSource, /hardcodedOpenid/)

  // 课表与身份改成云函数按 spaceId 生成，客户端不再上报 identity。
  const serviceSource = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/service.js'), 'utf8')
  assert.match(serviceSource, /buildAiKnowledgeContext/)
  assert.match(serviceSource, /resolveAiIdentity/)
  assert.doesNotMatch(serviceSource, /request\.identity|input\.identity/)
})

test('XiaoBa removes table separators and raw HTML from provider replies', () => {
  const { cleanAssistantText } = require('../miniprogram/utils/ai-text.js')
  const raw = '<b>今晚</b><br>散步\n| 事项 | 时间 |\n| --- | --- |\n| 散步 | 20:00 |'
  const clean = cleanAssistantText(raw)

  assert.equal(clean, '今晚\n散步\n事项 · 时间\n散步 · 20:00')
  assert.doesNotMatch(clean, /[<>|]/)
})

test('XiaoBa navigation starts below the system menu area and uses the light palette', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const source = fs.readFileSync(path.join(miniProgramRoot, 'pages/XiaoBa/index.js'), 'utf8')
  const styles = fs.readFileSync(path.join(miniProgramRoot, 'pages/XiaoBa/index.wxss'), 'utf8')

  assert.match(source, /const headerTop = Math\.max\([^\n]*menu\.bottom/)
  assert.match(styles, /background:\s*linear-gradient\(180deg,#fff0f6/)
  assert.doesNotMatch(styles, /#071c35|#12395c/)
})

test('XiaoBa uses one soft mascot mark across launcher, header, intro, and messages', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const config = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'app.json'), 'utf8'))
  const launcher = fs.readFileSync(path.join(miniProgramRoot, 'components/xiaoba-orb/index.wxml'), 'utf8')
  const page = fs.readFileSync(path.join(miniProgramRoot, 'pages/XiaoBa/index.wxml'), 'utf8')
  const markStyles = fs.readFileSync(path.join(miniProgramRoot, 'components/xiaoba-mark/index.wxss'), 'utf8')

  assert.equal(config.usingComponents['xiaoba-mark'], '/components/xiaoba-mark/index')
  assert.match(launcher, /<xiaoba-mark\s+size="launcher"\s*\/>/)
  assert.match(page, /<xiaoba-mark\s+size="header"\s+online\s*\/>/)
  assert.match(page, /<xiaoba-mark\s+size="intro"\s*\/>/)
  assert.match(page, /<xiaoba-mark\s+size="message"\s*\/>/)
  assert.match(markStyles, /#f7a8bb/i)
  assert.match(markStyles, /xiaoba-eye/)
  assert.match(markStyles, /xiaoba-smile/)
  assert.doesNotMatch(markStyles, /#315[bd]79|#3a6380|#ef5c91/i)
})

test('uploaded shared images render with server-resolved URLs', () => {
  const recordsMarkup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/Records/index.wxml'), 'utf8')
  const dinnerMarkup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/Dinner/index.wxml'), 'utf8')
  const apiSource = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/index.js'), 'utf8')

  assert.match(recordsMarkup, /item\.imageUrl\s*\|\|\s*item\.imageFileId/)
  assert.match(dinnerMarkup, /item\.imageUrl\s*\|\|\s*item\.imageFileId/)
  assert.match(apiSource, /resolveSharedMedia/)
})

test('primary create actions match XiaoBa launcher size and share its bottom baseline', () => {
  const miniProgramRoot = path.join(__dirname, '../miniprogram')
  const actionPages = ['Mission', 'Market', 'Dinner', 'Records']
  const actionMarkups = actionPages
    .map(page => fs.readFileSync(path.join(miniProgramRoot, `pages/${page}/index.wxml`), 'utf8'))
  const actionMarkup = actionMarkups
    .join('\n')
  const globalStyles = fs.readFileSync(path.join(miniProgramRoot, 'app.wxss'), 'utf8')

  assert.match(actionMarkup, /create-action-label/)
  assert.equal((actionMarkup.match(/<view class="create-action-icon">＋<\/view>/g) || []).length, 4)
  actionMarkups.forEach(markup => {
    assert.match(markup, /<\/view>\r?\n\r?\n<view[^\r\n]*class="create-action-capsule[^\r\n]*\r?\n\r?\n<xiaoba-orb \/>\s*$/)
  })
  assert.doesNotMatch(actionMarkup, /class="floating-plus"/)
  assert.match(globalStyles, /\.create-action-capsule\s*\{[^}]*right:\s*28rpx;[^}]*bottom:\s*calc\(172rpx \+ env\(safe-area-inset-bottom\)\);[^}]*width:\s*138rpx;[^}]*height:\s*72rpx;/s)
  assert.match(globalStyles, /\.create-action-capsule\s*\{[^}]*padding:\s*7rpx 14rpx 7rpx 8rpx;/s)
  assert.match(globalStyles, /\.create-action-copy>text:last-child\s*\{[^}]*display:\s*none;/s)

  const launcherStyles = fs.readFileSync(path.join(miniProgramRoot, 'components/xiaoba-orb/index.wxss'), 'utf8')
  assert.match(launcherStyles, /\.xiaoba-launcher\s*\{[^}]*left:\s*28rpx;[^}]*bottom:\s*calc\(172rpx \+ env\(safe-area-inset-bottom\)\);[^}]*width:\s*138rpx;[^}]*height:\s*72rpx;/s)
})

test('补充提醒可连续完成，处理中连点不会重复授权', async () => {
  let release
  let requests = 0
  let saved = 0
  const { app } = loadApp(
    { appId: 'x', envId: 'x' },
    async () => ({ result: { ok: true, data: { reminderCredits: ++saved } } }),
    () => { requests++; return new Promise(resolve => { release = resolve }) },
  )
  const first = app.addPartnerReminder()
  assert.equal(await app.addPartnerReminder(), null)
  release({status:'accept'})
  assert.equal((await first).reminderCredits, 1)
  const second = app.addPartnerReminder()
  release({status:'accept'})
  assert.equal((await second).reminderCredits, 2)
  assert.equal(requests, 2)
})

test('拒绝授权不登记，网络重试沿用同一登记标识', async () => {
  const config = { appId: 'x', envId: 'x' }
  let calls = 0
  const rejected = loadApp(config, async () => { calls++; }, async () => ({status:'reject'})).app
  assert.equal((await rejected.addPartnerReminder()).status, 'reject')
  assert.equal(calls, 0)
  const ids = []
  const accepted = loadApp(config, async request => {
    ids.push(request.data.data.grantId)
    if (ids.length === 1) throw new Error('lost response')
    return {result:{ok:true,data:{reminderCredits:1}}}
  }, async () => ({status:'accept'})).app
  assert.equal((await accepted.addPartnerReminder()).reminderCredits, 1)
  assert.equal(ids.length, 2)
  assert.equal(ids[0], ids[1])
})
