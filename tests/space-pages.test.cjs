const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

const space = require('../miniprogram/utils/space.js')
const { createReviewDemo } = require('../miniprogram/utils/review-demo.js')
const { createSpacePreview, inviteStatusFromToken, previewInviteToken } = require('../miniprogram/utils/space-preview.js')

const MINI_PROGRAM = path.join(__dirname, '../miniprogram')
const PAGES = path.join(MINI_PROGRAM, 'pages')

function readPageSource(name) {
  return fs.readFileSync(path.join(PAGES, name, 'index.js'), 'utf8')
}

function buildWx(options, collections) {
  const api = {
    showToast: value => collections.toasts.push(value),
    showLoading() {},
    hideLoading() {},
    hideToast() {},
    showModal: value => {
      collections.modals.push(value)
      if (typeof value.success === 'function') value.success({ confirm: options.modalConfirm !== false })
    },
    navigateTo: value => collections.navigations.push(value.url),
    switchTab: value => collections.navigations.push(value.url),
    redirectTo: value => collections.navigations.push(value.url),
    reLaunch: value => { collections.navigations.push(value.url); collections.relaunches.push(value.url) },
    navigateBack: () => collections.navigations.push('back'),
    getStorageSync: () => ({}),
    setStorageSync() {},
    removeStorageSync() {},
    getEnterOptionsSync: () => ({ query: options.enterQuery || {} }),
  }
  if (!options.clipboardMissing) {
    api.setClipboardData = value => {
      collections.clipboards.push(value.data)
      if (options.clipboardThrow) throw new Error('clipboard bridge crashed')
      if (options.clipboardFail) {
        if (typeof value.fail === 'function') value.fail({ errMsg: options.clipboardError || 'setClipboardData:fail scope denied' })
      } else if (typeof value.success === 'function') {
        value.success()
      }
    }
  }
  return api
}

// 三个空间流程页面共用的加载器：只放行它们真实依赖的模块。
function loadSpacePage(name, api, options = {}) {
  let page
  const collections = { apiCalls: [], navigations: [], relaunches: [], toasts: [], modals: [], clipboards: [] }
  const app = {
    globalData: {},
    previewMode: false,
    ensureConfigured: () => true,
    ensureWritable: () => true,
    renewPartnerReminderSilently: async () => null,
    enterPreview() { this.previewMode = true; return true },
    loadBootstrap: async () => {
      if (options.bootstrapSequence) {
        const next = options.bootstrapSequence.shift()
        if (next instanceof Error) throw next
        return next
      }
      if (options.bootstrapError) throw options.bootstrapError
      return options.bootstrap || {
        state: 'unpaired',
        user: name === 'Setup'
          ? { displayName: '我', avatarKey: 'cat', profileComplete: false, identityNoticeRequired: true, onboardingComplete: false }
          : { displayName: '阿禾', avatarKey: 'cat', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true },
        partner: null,
        space: null,
        features: {},
      }
    },
    api: async (action, data) => { collections.apiCalls.push({ action, data }); return api({ action, data }) },
  }

  vm.runInNewContext(readPageSource(name), {
    Page: value => { page = value },
    getApp: () => app,
    require: filename => {
      if (filename === '../../utils/share.js') return require('../miniprogram/utils/share.js')
      if (filename === '../../utils/space.js') return space
      if (filename === '../../utils/appearance.js') return require('../miniprogram/utils/appearance.js')
      if (filename === '../../utils/xiaoba-storage.js') return require('../miniprogram/utils/xiaoba-storage.js')
      assert.fail(`unexpected page dependency: ${filename}`)
    },
    wx: buildWx(options, collections),
    console: { warn() {}, error() {} },
    setTimeout() {},
    clearTimeout() {},
  })
  page.setData = patch => Object.assign(page.data, patch)
  return { page, app, source: readPageSource(name), ...collections }
}

function loadMainPage(api) {
  let page
  const apiCalls = []
  const navigations = []
  const globalData = {
    currentUser: { openid: 'a', displayName: '阿禾', avatarKey: 'cat' },
    partner: { openid: 'b', displayName: '小柚', avatarKey: 'rabbit' },
    space: { _id: 'space-ab', name: '我们的小屋', anniversaryDate: '', status: 'active' },
    features: { schedule: false, dinner: true, records: true, xiaoba: true },
    spaceState: 'ready',
  }
  const app = {
    globalData,
    previewMode: false,
    ensureConfigured: () => true,
    ensureWritable: () => true,
    isMine: openid => openid === globalData.currentUser.openid,
    nameOf: openid => space.nameOfMember(openid, globalData.currentUser, globalData.partner),
    myName: () => globalData.currentUser.displayName,
    partnerName: () => globalData.partner.displayName,
    renewPartnerReminderSilently: async () => null,
    loadBootstrap: async () => {
      const bootstrap = await app.api('getBootstrap')
      if (!space.isBootstrap(bootstrap)) {
        const error = new Error('云端还没有支持情侣空间，请先上传最新版云函数')
        error.code = 'BOOTSTRAP_UNAVAILABLE'
        throw error
      }
      return bootstrap
    },
    api: async (action, data) => { apiCalls.push({ action, data }); return api({ action, data }) },
  }

  vm.runInNewContext(readPageSource('MainPage'), {
    Page: value => { page = value },
    getApp: () => app,
    require: filename => {
      if (filename === '../../utils/share.js') return require('../miniprogram/utils/share.js')
      if (filename === '../../utils/anniversary.js') return require('../miniprogram/utils/anniversary.js')
      if (filename === '../../utils/space.js') return space
      if (filename === '../../utils/appearance.js') return require('../miniprogram/utils/appearance.js')
      if (filename === '../../utils/subscriptions.js') return {
        getPartnerReminderStatus: async () => ({ ready: false, text: '', action: '' }),
        requestPartnerReminder: async () => ({ status: 'accept' }),
      }
      assert.fail(`unexpected page dependency: ${filename}`)
    },
    wx: {
      showToast() {},
      showModal() {},
      navigateBack() {},
      navigateTo: value => navigations.push(value.url),
      reLaunch: value => navigations.push(value.url),
      getStorageSync: () => ({}),
      setStorageSync() {},
    },
    console: { warn() {}, error() {} },
    setTimeout() {},
    clearTimeout() {},
    setInterval() {},
    clearInterval() {},
  })
  page.setData = patch => Object.assign(page.data, patch)
  page.getTabBar = () => null
  return { page, apiCalls, navigations }
}

function loadWelcomePage(loadBootstrap, options = {}) {
  let page
  const navigations = []
  const app = {
    previewMode: options.previewMode === true,
    bootstrap: null,
    enterPreview() { this.previewMode = true; return true },
    exitPreview() { this.previewMode = false },
    async loadBootstrap() {
      const bootstrap = await loadBootstrap()
      this.bootstrap = bootstrap
      return bootstrap
    },
  }
  vm.runInNewContext(readPageSource('Welcome'), {
    Page: value => { page = value },
    getApp: () => app,
    require: filename => {
      if (filename === '../../utils/space.js') return space
      if (filename === '../../utils/share.js') return require('../miniprogram/utils/share.js')
      assert.fail(`unexpected page dependency: ${filename}`)
    },
    wx: {
      getEnterOptionsSync: () => ({ query: options.enterQuery || {} }),
      switchTab: value => navigations.push({ method: 'switchTab', url: value.url }),
      redirectTo: value => navigations.push({ method: 'redirectTo', url: value.url }),
      reLaunch: value => navigations.push({ method: 'reLaunch', url: value.url }),
    },
    console: { warn() {}, error() {} },
  })
  page.setData = patch => Object.assign(page.data, patch)
  return { page, app, navigations }
}

function readyBootstrap() {
  return {
    state: 'ready',
    user: { displayName: '阿禾', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true },
    partner: { displayName: '小柚' },
    space: { _id: 'space-1' },
  }
}

function newBootstrap() {
  return {
    state: 'unpaired',
    user: { displayName: '', profileComplete: false, identityNoticeRequired: true, onboardingComplete: false },
    partner: null,
    space: null,
  }
}

function loadReviewEntryPage() {
  let page
  const navigations = []
  const app = {
    previewMode: false,
    enterPreview() { this.previewMode = true },
  }
  vm.runInNewContext(readPageSource('ReviewEntry'), {
    Page: value => { page = value },
    getApp: () => app,
    require: filename => {
      if (filename === '../../utils/share.js') return require('../miniprogram/utils/share.js')
      assert.fail(`unexpected page dependency: ${filename}`)
    },
    wx: { switchTab: value => navigations.push({ method: 'switchTab', url: value.url }) },
  })
  return { page, app, navigations }
}

test('昵称与空间名按字数上限校验，空白一律拒绝', () => {
  assert.equal(space.validateDisplayName('').ok, false)
  assert.equal(space.validateDisplayName('   ').ok, false)
  assert.equal(space.validateDisplayName('abc').ok, true)
  assert.equal(space.validateDisplayName('a'.repeat(space.DISPLAY_NAME_MAX)).ok, true)
  assert.equal(space.validateDisplayName('a'.repeat(space.DISPLAY_NAME_MAX + 1)).ok, false)
  assert.equal(space.validateDisplayName('  阿禾  ').value, '阿禾')

  assert.equal(space.validateSpaceName('').ok, false)
  assert.equal(space.validateSpaceName('a'.repeat(space.SPACE_NAME_MAX)).ok, true)
  assert.equal(space.validateSpaceName('a'.repeat(space.SPACE_NAME_MAX + 1)).ok, false)
})

test('纪念日可以留空，格式错误、假日期和未来日期都要拦住', () => {
  const now = new Date(2026, 8, 16)
  assert.deepEqual(space.validateAnniversary('', now), { ok: true, value: '', error: '' })
  assert.equal(space.validateAnniversary('2025-01-01', now).ok, true)
  assert.equal(space.validateAnniversary('2026-09-16', now).ok, true)
  assert.equal(space.validateAnniversary('2026/01/01', now).ok, false)
  assert.equal(space.validateAnniversary('2026-02-30', now).ok, false)
  assert.equal(space.validateAnniversary('2026-09-17', now).ok, false)
  assert.match(space.validateAnniversary('2026-09-17', now).error, /不能晚于今天/)
})

test('只有形状完整的 bootstrap 才允许驱动页面跳转', () => {
  assert.equal(space.isBootstrap(null), false)
  assert.equal(space.isBootstrap([]), false)
  assert.equal(space.isBootstrap('ready'), false)
  assert.equal(space.isBootstrap({ state: '未定义状态', user: { displayName: '阿禾' } }), false)
  assert.equal(space.isBootstrap({ state: 'ready' }), false)
  assert.equal(space.isBootstrap({ state: 'ready', user: [] }), false)
  assert.equal(space.isBootstrap({ state: 'ready', user: { displayName: '阿禾' } }), false, '旧云函数缺少资料状态时必须拒绝')
  assert.equal(space.isBootstrap({ state: 'ready', user: { displayName: '阿禾', profileComplete: true } }), false, '昵称完成不能再冒充完整首次状态')
  assert.equal(space.isBootstrap({ state: 'ready', user: { displayName: '阿禾', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true } }), true)
  assert.equal(space.isBootstrap({ state: 'unpaired', user: { displayName: '我', profileComplete: false, identityNoticeRequired: true, onboardingComplete: false }, partner: null, space: null }), true)
})

test('六个状态各有文案，只有 ready 不需要离开首页', () => {
  assert.equal(space.stateView('ready'), null)
  assert.equal(space.stateView('unpaired').route, '/pages/Setup/index')
  assert.equal(space.stateView('frozen').route, '/pages/SpaceSetting/index')
  assert.equal(space.stateView('deleting').route, '/pages/SpaceSetting/index')
  for (const state of space.SPACE_STATES) {
    if (state === 'ready') continue
    const view = space.stateView(state)
    assert.ok(view.title, `${state} 缺少标题`)
    assert.ok(view.message, `${state} 缺少说明`)
    assert.ok(view.action, `${state} 缺少按钮文案`)
  }
})

test('六种邀请状态都有可读文案，只有有效邀请能加入', () => {
  for (const status of space.INVITE_STATUSES) {
    const view = space.inviteView(status)
    assert.ok(view.title, `${status} 缺少标题`)
    assert.equal(typeof view.canJoin, 'boolean', `${status} 的 canJoin 必须是布尔值`)
  }
  assert.equal(space.inviteView('valid').canJoin, true)
  assert.equal(space.inviteView('expired').canJoin, false)
  assert.equal(space.inviteView('used').canJoin, false)
  assert.equal(space.inviteView('full').canJoin, false)
  assert.equal(space.inviteView('occupied').canJoin, false)
  assert.equal(space.inviteView('不存在的状态').canJoin, false)
  assert.match(space.inviteView('expired').message, /48 小时/)
  assert.match(space.inviteView('used').message, /只能使用一次/)
  assert.match(space.inviteView('full').message, /最多两名成员/)
  assert.match(space.inviteView('occupied').message, /只能属于一个空间/)
})

test('启动参数里的邀请标识只取字符串，读不到时返回空', () => {
  const original = Object.prototype.hasOwnProperty.call(global, 'wx') ? global.wx : undefined
  try {
    global.wx = { getEnterOptionsSync: () => ({ query: { inviteToken: '  tok-abc  ' } }) }
    assert.equal(space.readPendingInviteToken(), 'tok-abc')

    global.wx = { getEnterOptionsSync: () => ({ query: { invite: 'tok-short' } }) }
    assert.equal(space.readPendingInviteToken(), 'tok-short')

    global.wx = { getEnterOptionsSync: () => { throw new Error('boom') } }
    assert.equal(space.readPendingInviteToken(), '')

    global.wx = {}
    assert.equal(space.readPendingInviteToken(), '')

    delete global.wx
    assert.equal(space.readPendingInviteToken(), '')

    global.wx = { getEnterOptionsSync: () => ({ query: { inviteToken: 'x'.repeat(400) } }) }
    assert.equal(space.readPendingInviteToken().length, 256)
  } finally {
    if (original === undefined) delete global.wx
    else global.wx = original
  }
})

test('预览适配器：标识前缀决定邀请状态，配对后一律算已占用', () => {
  assert.equal(inviteStatusFromToken('preview-expired'), 'expired')
  assert.equal(inviteStatusFromToken('preview-used'), 'used')
  assert.equal(inviteStatusFromToken('preview-full'), 'full')
  assert.equal(inviteStatusFromToken('preview-occupied'), 'occupied')
  assert.equal(inviteStatusFromToken('preview-valid'), 'valid')
  assert.equal(inviteStatusFromToken('任意标识'), 'valid')
  assert.equal(inviteStatusFromToken(''), 'missing')

  const paired = createSpacePreview()
  assert.equal(paired.snapshot().phase, 'ready')
  assert.equal(paired.handle('getInvite', { inviteToken: previewInviteToken('valid') }).status, 'occupied')

  const unpaired = createSpacePreview({ state: 'unpaired' })
  assert.equal(unpaired.handle('getBootstrap').state, 'unpaired')
  assert.equal(unpaired.handle('getBootstrap').partner, null)
  assert.equal(unpaired.handle('getBootstrap').space, null)
  for (const status of ['valid', 'expired', 'used', 'full', 'occupied']) {
    assert.equal(
      unpaired.handle('getInvite', { inviteToken: previewInviteToken(status) }).status,
      status,
      `${status} 应能从预览标识还原`,
    )
  }
  assert.equal(unpaired.handle('getInvite', { inviteToken: '' }).status, 'missing')
})

test('预览适配器：有效邀请才会放行加入，其他状态一律报错', () => {
  const preview = createSpacePreview({ state: 'unpaired' })
  assert.equal(preview.handle('joinSpace', { inviteToken: previewInviteToken('valid') }).spaceId, 'preview-space')
  assert.equal(preview.handle('getBootstrap').state, 'ready')

  const blocked = createSpacePreview({ state: 'unpaired' })
  assert.throws(
    () => blocked.handle('joinSpace', { inviteToken: previewInviteToken('expired') }),
    error => error.code === 'INVITE_UNAVAILABLE',
  )
  assert.equal(blocked.handle('getBootstrap').state, 'unpaired')
})

test('预览适配器：创建、改设置、重新生成邀请、注销撤销、解除都能走通', () => {
  const preview = createSpacePreview({ state: 'unpaired' })
  const created = preview.handle('createSpace', { name: '示例空间', anniversaryDate: '2024-05-20' })
  assert.equal(created.spaceId, 'preview-space')
  assert.equal(created.inviteToken, 'preview-valid')
  assert.ok(created.expiresAt)

  const boot = preview.handle('getBootstrap')
  assert.equal(boot.state, 'ready')
  assert.equal(boot.space.name, '示例空间')
  assert.equal(boot.space.anniversaryDate, '2024-05-20')
  assert.equal(boot.user.canEditMood, true)
  assert.equal(boot.user.canSyncSteps, true)
  assert.equal(boot.partner.canEditMood, false)
  assert.equal(boot.partner.canSyncSteps, false)

  assert.equal(preview.handle('updateProfile', { displayName: ' 新昵称 ' }).displayName, '新昵称')
  assert.equal(preview.identity.currentUser.displayName, '新昵称')

  assert.equal(preview.handle('updateSpace', { name: '改过的名字', anniversaryDate: '' }).name, '改过的名字')
  assert.equal(preview.handle('getBootstrap').space.anniversaryDate, '')

  assert.equal(preview.handle('regenerateInvite').inviteToken, 'preview-valid')
  assert.equal(preview.handle('requestSpaceDeletion').phase, 'awaiting_partner')
  assert.equal(preview.handle('getBootstrap').state, 'ready')
  assert.equal(preview.handle('getBootstrap').space.deletion.phase, 'awaiting_partner')
  assert.equal(preview.handle('cancelSpaceDeletion').phase, 'none')
  assert.equal(preview.handle('getBootstrap').space.deletion, null)
  assert.equal(preview.handle('unpair').removed, true)
  assert.equal(preview.handle('getBootstrap').state, 'unpaired')
})

test('预览适配器：非空间类读写交给只读体验数据，写入仍然被拒绝', () => {
  const fallback = createReviewDemo()
  const preview = createSpacePreview({ fallback })
  assert.ok(Array.isArray(preview.handle('getUsers')))
  assert.throws(
    () => preview.handle('createMemoryPost', { content: '不应保存' }),
    error => error.code === 'REVIEW_READ_ONLY',
  )

  const bare = createSpacePreview()
  assert.throws(() => bare.handle('getUsers'), error => error.code === 'REVIEW_READ_ONLY')
})

test('预览示例数据不含真实姓名与私人日期', () => {
  const preview = createSpacePreview()
  const text = JSON.stringify(preview.snapshot()) + JSON.stringify(preview.handle('getBootstrap'))
  assert.doesNotMatch(text, /PRIVATE_MARKER_42/)
})

test('首次设置页：昵称不合格时不进入下一步，也不请求云端', () => {
  const { page, apiCalls, toasts } = loadSpacePage('Setup', async () => ({}))
  page.setData({ displayName: '   ' })
  page.goChoice()
  assert.equal(page.data.step, 'profile')
  assert.match(toasts[0].title, /昵称/)
  assert.equal(apiCalls.length, 0)
})

test('注销视图把服务端状态转换成唯一可执行的下一步', () => {
  const base = { state: 'ready', user: { profileComplete: true }, partner: {}, space: { deletion: null } }
  assert.equal(space.deletionView(base).mode, 'normal')
  assert.equal(space.deletionView({ ...base, space: { deletion: { phase: 'awaiting_partner', isRequester: true } } }).mode, 'awaiting-requester')
  assert.equal(space.deletionView({ ...base, space: { deletion: { phase: 'awaiting_partner', canApprove: true } } }).mode, 'awaiting-partner')
  assert.equal(space.deletionView({ ...base, state: 'deleting', space: { deletion: { phase: 'cooldown', cooldownEndsAt: '2026-09-21T04:00:00.000Z', canFinalize: false } } }).mode, 'cooldown')
  assert.equal(space.deletionView({ ...base, state: 'deleting', space: { deletion: { phase: 'cooldown', cooldownEndsAt: '2026-09-20T04:00:00.000Z', canFinalize: true } } }).mode, 'ready-to-purge')
  assert.equal(space.deletionView({ ...base, state: 'deleting', space: { deletion: { phase: 'purging', progress: { removedCount: 3 } } } }).mode, 'purging')
  assert.equal(space.deletionView({ ...base, state: 'deleting', space: { deletion: { phase: 'legacy', canRestore: true } } }).mode, 'legacy')
})

test('小八入口只允许完整双人正常空间显示', () => {
  const paired = {
    state: 'ready',
    user: { profileComplete: true },
    partner: { profileComplete: true },
    space: { status: 'active' },
    features: { xiaoba: true },
  }
  assert.equal(space.canShowXiaoBa(paired, false), true)
  assert.equal(space.canShowXiaoBa({ ...paired, partner: null }, false), false)
  assert.equal(space.canShowXiaoBa({ ...paired, state: 'deleting' }, false), false)
  assert.equal(space.canShowXiaoBa({ ...paired, user: { profileComplete: false } }, false), false)
  assert.equal(space.canShowXiaoBa({ ...paired, features: { xiaoba: false } }, false), false)
  assert.equal(space.canShowXiaoBa(paired, true), false)
})

test('首次设置页：新用户未确认微信身份说明时不能进入下一步', () => {
  const { page, apiCalls, toasts } = loadSpacePage('Setup', async () => ({}))
  page.setData({ displayName: '阿禾', identityNoticeAccepted: false })

  page.goChoice()

  assert.equal(page.data.step, 'profile')
  assert.match(toasts.at(-1).title, /微信身份/)
  assert.equal(apiCalls.length, 0)
})

test('首次设置只填写昵称，不再展示无实际用途的预设头像选择', () => {
  const source = readPageSource('Setup')
  const markup = fs.readFileSync(path.join(PAGES, 'Setup', 'index.wxml'), 'utf8')
  const homeMarkup = fs.readFileSync(path.join(PAGES, 'MainPage', 'index.wxml'), 'utf8')

  assert.doesNotMatch(markup, /选一个头像|avatar-grid|预设头像/)
  assert.doesNotMatch(source, /\bAVATARS\b|selectAvatar\s*\(/)
  assert.match(homeMarkup, /双方头像/)
  assert.match(homeMarkup, /我的头像/)
})

test('首次设置页：填好昵称后创建空间，先提交昵称再提交空间', async () => {
  const { page, apiCalls, navigations } = loadSpacePage('Setup', async ({ action }) => {
    if (action === 'updateProfile') return { displayName: '阿禾' }
    if (action === 'createSpace') return { spaceId: 'space-1', inviteToken: 'tok-1', expiresAt: '2026-09-18T00:00:00.000Z' }
    return null
  })
  page.setData({ displayName: ' 阿禾 ', avatarKey: 'fox', identityNoticeAccepted: true })
  page.goChoice()
  assert.equal(page.data.step, 'choice')
  assert.equal(page.data.displayName, '阿禾')

  page.chooseCreate()
  assert.equal(page.data.step, 'create')
  assert.equal(page.data.spaceName, '阿禾的小屋')

  await page.submitCreate()
  assert.deepEqual(apiCalls.map(call => call.action), ['updateProfile', 'createSpace'])
  assert.equal(apiCalls[0].data.displayName, '阿禾')
  assert.equal(apiCalls[0].data.avatarKey, 'fox')
  assert.equal(apiCalls[0].data.identityNoticeAccepted, true)
  assert.equal(apiCalls[1].data.name, '阿禾的小屋')
  assert.equal(apiCalls[1].data.anniversaryDate, '')
  assert.equal(
    navigations.at(-1),
    '/pages/SpaceSetting/index?inviteToken=tok-1&expiresAt=2026-09-18T00%3A00%3A00.000Z',
  )
})

test('首次设置页：验收不过的纪念日不会建空间', async () => {
  const { page, apiCalls, toasts } = loadSpacePage('Setup', async ({ action }) => {
    if (action === 'updateProfile') return {}
    if (action === 'createSpace') return { spaceId: 'space-1' }
    return null
  })
  page.setData({ displayName: '阿禾', identityNoticeAccepted: true, step: 'create', spaceName: '我们的小屋', anniversaryDate: '2999-01-01' })
  await page.submitCreate()
  assert.deepEqual(apiCalls, [])
  assert.match(toasts.at(-1).title, /不能晚于今天/)
})

test('首次设置页：没有启动参数时进入邀请码输入，空邀请码不会继续', async () => {
  const withoutInvite = loadSpacePage('Setup', async () => ({}))
  withoutInvite.page.setData({ displayName: '阿禾', avatarKey: 'fox', identityNoticeAccepted: true, step: 'choice' })
  withoutInvite.page.chooseJoin()
  assert.equal(withoutInvite.page.data.step, 'join')
  await withoutInvite.page.submitJoin()
  assert.deepEqual(withoutInvite.apiCalls, [])
  assert.deepEqual(withoutInvite.navigations, [])
  assert.match(withoutInvite.toasts.at(-1).title, /邀请码/)
})

test('首次设置页：粘贴邀请码会保存资料并打开邀请确认页', async () => {
  const { page, apiCalls, navigations } = loadSpacePage('Setup', async ({ action }) => {
    if (action === 'updateProfile') return { displayName: '阿禾', avatarKey: 'fox' }
    return null
  })
  page.setData({ displayName: '阿禾', avatarKey: 'fox', identityNoticeAccepted: true, step: 'join' })
  page.setJoinInviteToken({ detail: { value: '  tok 1/2  ' } })
  await page.submitJoin()
  assert.deepEqual(apiCalls.map(call => call.action), ['updateProfile'])
  assert.equal(navigations.at(-1), '/pages/Invite/index?inviteToken=tok%201%2F2')
})

test('首次设置页：带邀请首次进入仍先完成资料，再进入邀请确认', async () => {
  const direct = loadSpacePage('Setup', async () => ({}))
  await direct.page.onLoad({ inviteToken: 'tok 1/2' })
  assert.equal(direct.page.data.step, 'profile')
  assert.equal(direct.page.data.joinInviteToken, 'tok 1/2')
  assert.deepEqual(direct.navigations, [])

  direct.page.setData({ displayName: '阿禾', identityNoticeAccepted: true })
  direct.page.goChoice()
  assert.equal(direct.page.data.step, 'join')
  await direct.page.submitJoin()
  assert.equal(direct.navigations.at(-1), '/pages/Invite/index?inviteToken=tok%201%2F2')
})

test('首次设置页：已完成资料的老用户不必重填，按是否带邀请进入正确步骤', async () => {
  const completed = {
    state: 'unpaired',
    user: { displayName: '阿禾', avatarKey: 'fox', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true },
    partner: null,
    space: null,
    features: {},
  }
  const withoutInvite = loadSpacePage('Setup', async () => ({}), { bootstrap: completed })
  await withoutInvite.page.onLoad({})
  assert.equal(withoutInvite.page.data.step, 'choice')
  assert.equal(withoutInvite.page.data.displayName, '阿禾')
  assert.equal(withoutInvite.page.data.avatarKey, 'fox')

  const withInvite = loadSpacePage('Setup', async () => ({}), { bootstrap: completed })
  await withInvite.page.onLoad({ inviteToken: 'tok-7' })
  assert.equal(withInvite.page.data.step, 'join')
  assert.equal(withInvite.page.data.joinInviteToken, 'tok-7')
  assert.equal(withInvite.page.data.displayName, '阿禾')
})

test('已注册且没有空间的账号能从创建或加入页进入账号与安全', async () => {
  const markup = fs.readFileSync(path.join(PAGES, 'Setup', 'index.wxml'), 'utf8')
  const { page, navigations } = loadSpacePage('Setup', async () => ({}), {
    bootstrap: {
      state: 'unpaired',
      user: { registered: true, displayName: '阿禾', avatarKey: 'cat', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true },
      partner: null,
      space: null,
      features: {},
    },
  })

  await page.onLoad({})

  assert.equal(page.data.step, 'choice')
  assert.equal(page.data.accountRegistered, true)
  assert.match(markup, /accountRegistered[^>]*bindtap="openAccountSecurity"/)
  assert.match(markup, /账号与安全/)
  page.openAccountSecurity()
  assert.deepEqual(navigations, ['/pages/SpaceSetting/index'])
})

test('已建号但首次资料未完成的账号也能进入账号与安全', async () => {
  const { page, navigations } = loadSpacePage('Setup', async () => ({}), {
    bootstrap: {
      state: 'unpaired',
      user: { registered: true, displayName: '', avatarKey: 'cat', profileComplete: false, identityNoticeRequired: true, onboardingComplete: false },
      partner: null,
      space: null,
      features: {},
    },
  })

  await page.onLoad({})
  assert.equal(page.data.step, 'profile')
  assert.equal(page.data.accountRegistered, true)
  page.openAccountSecurity()
  assert.deepEqual(navigations, ['/pages/SpaceSetting/index'])
})

test('新用户或账号状态读取失败时不显示注销入口', async () => {
  const newUser = loadSpacePage('Setup', async () => ({}), {
    bootstrap: {
      state: 'unpaired',
      user: { registered: false, displayName: '', avatarKey: 'cat', profileComplete: false, identityNoticeRequired: true, onboardingComplete: false },
      partner: null,
      space: null,
      features: {},
    },
  })
  await newUser.page.onLoad({})
  assert.equal(newUser.page.data.accountRegistered, false)
  newUser.page.openAccountSecurity()
  assert.deepEqual(newUser.navigations, [])

  const failure = loadSpacePage('Setup', async () => ({}), { bootstrapError: new Error('连接失败') })
  await failure.page.onLoad({})
  assert.equal(failure.page.data.accountRegistered, false)
  failure.page.openAccountSecurity()
  assert.deepEqual(failure.navigations, [])
})

test('首次设置页等待身份结果时不展示新用户表单，失败后只允许重试', async () => {
  const markup = fs.readFileSync(path.join(PAGES, 'Setup', 'index.wxml'), 'utf8')
  const { page, navigations } = loadSpacePage('Setup', async () => ({}), { bootstrapError: new Error('连接失败') })

  assert.equal(page.data.renderStatus, 'loading')
  assert.match(markup, /renderStatus === 'loading'/)
  assert.match(markup, /renderStatus === 'error'/)
  assert.match(markup, /bindtap="retryLoad"/)
  assert.match(markup, /renderStatus === 'ready' && step === 'profile'/)
  await page.onLoad({})
  assert.equal(page.data.renderStatus, 'error')
  assert.equal(page.data.accountRegistered, false)
  assert.deepEqual(navigations, [])
})

test('首次设置页重新加载会重新确认身份并保留邀请', async () => {
  const bootstrap = {
    state: 'unpaired',
    user: { registered: true, displayName: '阿禾', avatarKey: 'cat', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true },
    partner: null,
    space: null,
    features: {},
  }
  const { page } = loadSpacePage('Setup', async () => ({}), { bootstrapSequence: [new Error('短暂断线'), bootstrap] })

  await page.onLoad({ inviteToken: 'invite-123' })
  assert.equal(page.data.renderStatus, 'error')
  await page.retryLoad()
  assert.equal(page.data.renderStatus, 'ready')
  assert.equal(page.data.step, 'join')
  assert.equal(page.data.joinInviteToken, 'invite-123')
  assert.equal(page.data.accountRegistered, true)
})

test('首次设置页被已在空间的账号直达时回欢迎页重新分流', async () => {
  const { page, navigations } = loadSpacePage('Setup', async () => ({}), { bootstrap: readyBootstrap() })

  await page.onLoad({})

  assert.equal(page.data.renderStatus, 'redirecting')
  assert.deepEqual(navigations, ['/pages/Welcome/index'])
})

test('入口分流只按完整 bootstrap 显式状态决定', () => {
  const baseUser = {
    displayName: '阿禾',
    profileComplete: true,
    identityNoticeRequired: false,
    onboardingComplete: true,
  }
  const route = (bootstrap, inviteToken) => space.resolveEntry(bootstrap, inviteToken)

  assert.deepEqual(route({
    state: 'ready',
    user: baseUser,
    partner: { displayName: '小柚' },
    space: { _id: 'space-1' },
  }), { kind: 'home', method: 'switchTab', url: '/pages/MainPage/index' })
  assert.deepEqual(route({ state: 'unpaired', user: baseUser, partner: null, space: null }), {
    kind: 'unpaired',
    method: 'redirectTo',
    url: '/pages/Setup/index?step=choice',
  })
  assert.equal(
    route({ state: 'unpaired', user: baseUser, partner: null, space: null }, 'invite 1').url,
    '/pages/Setup/index?step=join&inviteToken=invite%201',
  )
  assert.equal(
    route({
      state: 'unpaired',
      user: { ...baseUser, onboardingComplete: false },
      partner: null,
      space: null,
    }, 'invite 1').url,
    '/pages/Setup/index?step=profile&inviteToken=invite%201',
  )
  assert.equal(route({
    state: 'ready', user: baseUser, partner: null, space: { _id: 'space-1' },
  }).url, '/pages/SpaceSetting/index')
  assert.equal(route({
    state: 'ready',
    user: baseUser,
    partner: { displayName: '小柚' },
    space: { _id: 'space-1', deletion: { phase: 'awaiting_partner' } },
  }).kind, 'pending')
  assert.equal(route({
    state: 'frozen', user: baseUser, partner: { displayName: '小柚' }, space: { _id: 'space-1' },
  }).url, '/pages/SpaceSetting/index')
  assert.deepEqual(route(null), { kind: 'error', method: '', url: '' })
})

test('欢迎页让已配对账号直接进入首页', async () => {
  const { page, navigations } = loadWelcomePage(async () => readyBootstrap())

  await page.onLoad({})

  assert.deepEqual(navigations, [{ method: 'switchTab', url: '/pages/MainPage/index' }])
})

test('欢迎页让已注册未配对账号直接进入空间选择', async () => {
  const bootstrap = {
    ...newBootstrap(),
    user: { displayName: '阿禾', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true },
  }
  const { page, navigations } = loadWelcomePage(async () => bootstrap)

  await page.onLoad({})

  assert.deepEqual(navigations, [{ method: 'redirectTo', url: '/pages/Setup/index?step=choice' }])
})

test('欢迎页为新账号保留邀请码并等待用户开始首次流程', async () => {
  const { page, navigations } = loadWelcomePage(async () => newBootstrap())

  await page.onLoad({ inviteToken: 'invite 1' })

  assert.equal(page.data.status, 'welcome')
  assert.deepEqual(navigations, [])
  page.startOnboarding()
  assert.deepEqual(navigations, [{
    method: 'redirectTo',
    url: '/pages/Setup/index?step=profile&inviteToken=invite%201',
  }])
})

test('欢迎页让新用户先看示例空间且不提交任何资料', async () => {
  const { page, app, navigations } = loadWelcomePage(async () => newBootstrap())

  await page.onLoad({})
  page.browseDemo()

  assert.equal(app.previewMode, true)
  assert.deepEqual(navigations, [{ method: 'switchTab', url: '/pages/MainPage/index' }])
  const markup = fs.readFileSync(path.join(PAGES, 'Welcome', 'index.wxml'), 'utf8')
  assert.match(markup, /先看看示例空间/)
  assert.match(markup, /创建或加入自己的空间/)
  assert.match(markup, /不需要手机号|不会读取微信头像/)
})

test('欢迎页失败后停留并且重新加载会真正再次请求', async () => {
  let attempts = 0
  const { page, navigations } = loadWelcomePage(async () => {
    attempts += 1
    if (attempts === 1) throw new Error('network')
    return readyBootstrap()
  })

  await page.onLoad({})
  assert.equal(page.data.status, 'error')
  assert.equal(page.data.busy, false)
  assert.deepEqual(navigations, [])

  await page.retryLoad()

  assert.equal(attempts, 2)
  assert.deepEqual(navigations, [{ method: 'switchTab', url: '/pages/MainPage/index' }])
})

test('欢迎页加载中拒绝并发重试', async () => {
  let release
  let attempts = 0
  const pending = new Promise(resolve => { release = resolve })
  const { page } = loadWelcomePage(async () => {
    attempts += 1
    await pending
    return readyBootstrap()
  })

  const first = page.onLoad({})
  await page.retryLoad()
  assert.equal(attempts, 1)
  release()
  await first
})

test('欢迎页会清除上一段审核演示会话再读取真实账号', async () => {
  const { page, app } = loadWelcomePage(async () => readyBootstrap(), { previewMode: true })

  await page.onLoad({})

  assert.equal(app.previewMode, false)
})

test('首次设置页：新体系账号已有昵称但未确认时仍停在身份确认步骤', async () => {
  const incomplete = {
    state: 'unpaired',
    user: { displayName: '旧客户端昵称', avatarKey: 'rabbit', profileComplete: true, identityNoticeRequired: true, onboardingComplete: false },
    partner: null,
    space: null,
    features: {},
  }
  const { page } = loadSpacePage('Setup', async () => ({}), { bootstrap: incomplete })

  await page.onLoad({})

  assert.equal(page.data.step, 'profile')
  assert.equal(page.data.displayName, '旧客户端昵称')
  assert.equal(page.data.avatarKey, 'rabbit')
  assert.equal(page.data.identityNoticeAccepted, false)
})

test('首次设置页：从无权限恢复入口进入时仍允许填写首次资料', async () => {
  const bootstrapError = Object.assign(new Error('当前微信账号没有使用权限'), { code: 'UNAUTHORIZED' })
  const { page } = loadSpacePage('Setup', async () => null, { bootstrapError })

  await page.onLoad({})

  assert.equal(page.data.step, 'profile')
  assert.equal(page.data.identityNoticeAccepted, false)
  assert.equal(page.data.error, '')
})

test('首次设置页：创建页返回创建或加入选择，不重填资料', () => {
  const { page } = loadSpacePage('Setup', async () => ({}))
  page.setData({ step: 'create', displayName: '阿禾' })
  page.backToChoice()
  assert.equal(page.data.step, 'choice')
  assert.equal(page.data.displayName, '阿禾')
})

test('配对页：旧邀请直达时空资料账号回到首次设置', async () => {
  const { page, navigations, apiCalls } = loadSpacePage('Invite', async () => {
    throw new Error('空资料时不应该读取邀请')
  }, {
    bootstrap: {
      state: 'unpaired',
      user: { displayName: '我', avatarKey: 'cat', profileComplete: false, identityNoticeRequired: true, onboardingComplete: false },
      partner: null,
      space: null,
      features: {},
    },
  })

  await page.onLoad({ inviteToken: 'tok-9' })
  assert.deepEqual(navigations, ['/pages/Setup/index?inviteToken=tok-9'])
  assert.deepEqual(apiCalls, [])
})

test('配对页：已有昵称但首次身份确认未完成时仍回到设置页', async () => {
  const { page, navigations, apiCalls } = loadSpacePage('Invite', async () => {
    throw new Error('首次身份确认前不应该读取邀请')
  }, {
    bootstrap: {
      state: 'unpaired',
      user: { displayName: '旧客户端昵称', avatarKey: 'cat', profileComplete: true, identityNoticeRequired: true, onboardingComplete: false },
      partner: null,
      space: null,
      features: {},
    },
  })

  await page.onLoad({ inviteToken: 'tok-modern' })
  assert.deepEqual(navigations, ['/pages/Setup/index?inviteToken=tok-modern'])
  assert.deepEqual(apiCalls, [])
})

test('配对页：身份状态读取失败时停止，不读取邀请也不允许加入', async () => {
  const { page, apiCalls } = loadSpacePage('Invite', async () => {
    throw new Error('不应该读取邀请')
  }, { bootstrapError: Object.assign(new Error('云端暂时不可用'), { code: 'NETWORK_ERROR' }) })

  await page.onLoad({ inviteToken: 'tok-9' })
  assert.deepEqual(apiCalls, [])
  assert.equal(page.data.loading, false)
  assert.equal(page.data.canJoin, false)
  assert.match(page.data.viewTitle, /无法确认|稍后再试/)
  assert.match(page.data.error, /云端暂时不可用/)
})

test('普通首次流程不暴露审核演示入口', () => {
  const source = readPageSource('Setup')
  const markup = fs.readFileSync(path.join(PAGES, 'Setup', 'index.wxml'), 'utf8')

  assert.doesNotMatch(source, /enterPreview/)
  assert.doesNotMatch(markup, /先看看效果|审核体验/)
})

test('审核模式只能由独立 ReviewEntry 页面主动开启', () => {
  const { page, app, navigations } = loadReviewEntryPage()

  page.onLoad()

  assert.equal(app.previewMode, true)
  assert.deepEqual(navigations, [{ method: 'switchTab', url: '/pages/MainPage/index' }])
})

test('配对页：六种状态各自决定能不能加入', async () => {
  const cases = [
    ['valid', true, '小柚'],
    ['expired', false, ''],
    ['used', false, ''],
    ['full', false, ''],
    ['occupied', false, ''],
    ['missing', false, ''],
  ]
  for (const [status, canJoin, inviterName] of cases) {
    const { page } = loadSpacePage('Invite', async ({ action }) => {
      if (action === 'getInvite') return { status, spaceName: '示例空间', inviterName: '小柚' }
      return null
    })
    await page.onLoad({ inviteToken: '  tok-1  ' })
    assert.equal(page.data.status, status, `${status} 状态未生效`)
    assert.equal(page.data.canJoin, canJoin, `${status} 的 canJoin 不正确`)
    assert.ok(page.data.viewTitle, `${status} 缺少标题`)
    assert.equal(page.data.spaceName, status === 'valid' ? '示例空间' : '', `${status} 不应展示空间内容`)
    assert.equal(page.data.inviterName, inviterName, `${status} 的邀请人展示不正确`)
    assert.equal(page.data.loading, false)
  }
})

test('配对页：已有空间的人不能加入时能回自己的空间处理，且解释单人空间限制', async () => {
  const { page, navigations } = loadSpacePage('Invite', async ({ action }) => {
    if (action === 'getInvite') return { status: 'occupied' }
    return null
  }, { bootstrap: {
    state: 'ready', user: { displayName: '阿禾', profileComplete: true, onboardingComplete: true },
    partner: null, space: { name: '我的小屋' },
  } })
  await page.onLoad({ inviteToken: 'other-space-invite' })
  assert.equal(page.data.canJoin, false)
  assert.match(page.data.viewMessage, /最后一名成员|单人空间/)
  page.goOwnSpace()
  assert.equal(navigations.at(-1), '/pages/SpaceSetting/index')
  const markup = fs.readFileSync(path.join(PAGES, 'Invite', 'index.wxml'), 'utf8')
  assert.match(markup, /status === 'occupied'/)
  assert.match(markup, /bindtap="goOwnSpace"/)
})

test('配对页：页面参数丢失时仍从微信进入参数恢复邀请码', async () => {
  const { page, apiCalls } = loadSpacePage('Invite', async ({ action }) => {
    if (action === 'getInvite') return { status: 'valid', spaceName: '示例空间', inviterName: '小柚' }
    return null
  }, { enterQuery: { inviteToken: 'tok-from-launch' } })

  await page.onLoad({})

  assert.equal(page.data.inviteToken, 'tok-from-launch')
  assert.equal(apiCalls.find(call => call.action === 'getInvite').data.inviteToken, 'tok-from-launch')
  assert.equal(page.data.canJoin, true)
})

test('配对页：无效或缺失邀请允许手动粘贴新邀请码继续核对', async () => {
  const { page, apiCalls } = loadSpacePage('Invite', async ({ action, data }) => {
    if (action === 'getInvite') {
      return data.inviteToken === 'fresh-token'
        ? { status: 'valid', spaceName: '我们的小屋', inviterName: '阿禾' }
        : { status: 'missing' }
    }
    return null
  })

  await page.onLoad({})
  assert.equal(page.data.status, 'missing')
  assert.equal(page.data.canJoin, false)
  page.setInviteTokenInput({ detail: { value: ' fresh-token ' } })
  await page.retryWithInviteToken()

  assert.equal(page.data.inviteToken, 'fresh-token')
  assert.equal(apiCalls.at(-1).data.inviteToken, 'fresh-token')
  assert.equal(page.data.spaceName, '我们的小屋')
  assert.equal(page.data.canJoin, true)
  const markup = fs.readFileSync(path.join(PAGES, 'Invite', 'index.wxml'), 'utf8')
  assert.match(markup, /粘贴邀请码/)
  assert.match(markup, /返回创建或加入选择/)
})

test('配对页：读取失败时按无效邀请处理，不冒充可加入', async () => {
  const { page } = loadSpacePage('Invite', async () => { throw new Error('网络不可用') })
  await page.onLoad({ inviteToken: 'tok-1' })
  assert.equal(page.data.canJoin, false)
  assert.equal(page.data.loading, false)
  assert.match(page.data.error, /网络不可用/)
})

test('配对页：只有可加入时才发出 joinSpace，成功后回首页', async () => {
  const { page, apiCalls, navigations } = loadSpacePage('Invite', async ({ action }) => {
    if (action === 'getInvite') return { status: 'valid', spaceName: '示例空间', inviterName: '小柚' }
    if (action === 'joinSpace') return { spaceId: 'space-1' }
    return null
  })
  await page.onLoad({ inviteToken: 'tok-1' })
  await page.confirmJoin()
  const joined = apiCalls.filter(call => call.action === 'joinSpace')
  assert.equal(joined.length, 1)
  assert.equal(joined[0].data.inviteToken, 'tok-1')
  assert.equal(navigations.at(-1), '/pages/MainPage/index')

  const blocked = loadSpacePage('Invite', async () => ({ status: 'expired' }))
  await blocked.page.onLoad({ inviteToken: 'tok-1' })
  await blocked.page.confirmJoin()
  assert.equal(blocked.apiCalls.some(call => call.action === 'joinSpace'), false)
})

test('空间设置页：读完整信息后展示空间与伴侣状态', async () => {
  const bootstrap = {
    state: 'ready',
    user: { displayName: '阿禾', avatarKey: 'cat' },
    partner: { displayName: '小柚' },
    space: { name: '我们的小屋', anniversaryDate: '2024-05-20' },
  }
  const { page } = loadSpacePage('SpaceSetting', async () => bootstrap)
  await page.onLoad()
  assert.equal(page.data.loading, false)
  assert.equal(page.data.state, 'ready')
  assert.equal(page.data.displayName, '阿禾')
  assert.equal(page.data.spaceName, '我们的小屋')
  assert.equal(page.data.anniversaryDate, '2024-05-20')
  assert.equal(page.data.partnerName, '小柚')
  assert.equal(page.data.partnerStatus, '已配对')
  assert.equal(page.data.sharePath, '/pages/MainPage/index')
  assert.match(page.onShareAppMessage().title, /不含邀请码|索要邀请码/)
})

test('空间设置页：未配对时给出建立空间的入口', async () => {
  const { page, navigations } = loadSpacePage('SpaceSetting', async () => ({
    state: 'unpaired',
    user: { displayName: '阿禾', avatarKey: 'cat' },
    partner: null,
    space: null,
  }))
  await page.onLoad()
  assert.equal(page.data.state, 'unpaired')
  assert.equal(page.data.partnerStatus, '未配对')
  assert.equal(page.data.partnerName, '还没有伴侣')
  page.goSetup()
  assert.deepEqual(navigations, ['/pages/Setup/index'])
})

test('空间设置页：未配对已注册账号可以双重确认注销，未注册访客不显示入口', async () => {
  const markup = fs.readFileSync(path.join(PAGES, 'SpaceSetting', 'index.wxml'), 'utf8')
  assert.match(markup, /此前共同空间的内容.*对方保留/)
  const { page, apiCalls, modals, navigations, relaunches } = loadSpacePage('SpaceSetting', async ({ action }) => {
    if (action === 'getBootstrap') return {
      state: 'unpaired',
      user: { registered: true, displayName: '阿禾', avatarKey: 'cat' },
      partner: null,
      space: null,
    }
    if (action === 'deleteAccount') return { deleted: true }
    return null
  })
  await page.onLoad()
  assert.equal(page.data.accountRegistered, true)
  assert.match(markup, /accountRegistered/)
  assert.match(markup, /注销个人账号/)

  await page.deleteAccount()
  assert.equal(modals.length, 2)
  assert.equal(apiCalls.filter(call => call.action === 'deleteAccount').length, 1)
  assert.equal(navigations.at(-1), '/pages/Welcome/index')
  assert.deepEqual(relaunches, ['/pages/Welcome/index'])

  const visitor = loadSpacePage('SpaceSetting', async () => ({
    state: 'unpaired',
    user: { registered: false, displayName: '我', avatarKey: 'cat' },
    partner: null,
    space: null,
  }))
  await visitor.page.onLoad()
  assert.equal(visitor.page.data.accountRegistered, false)
})

test('普通 sitemap 明确屏蔽审核演示入口', () => {
  const sitemap = JSON.parse(fs.readFileSync(path.join(MINI_PROGRAM, 'sitemap.json'), 'utf8'))
  assert.ok(sitemap.rules.some(rule => rule.action === 'disallow' && rule.page === 'pages/ReviewEntry/index'))
})

test('空间设置页：读不到 bootstrap 时给出提示而不是崩掉', async () => {
  const { page } = loadSpacePage('SpaceSetting', async () => { throw new Error('云端暂时不可用') })
  await page.onLoad()
  assert.equal(page.data.loading, false)
  assert.match(page.data.loadError, /云端暂时不可用/)
  assert.equal(page.data.loadRecovery, 'retry')
})

test('空间设置页：账号首次设置未完成时停止渲染空间表单并提供恢复入口', async () => {
  const blocked = Object.assign(new Error('当前微信账号没有使用权限'), { code: 'UNAUTHORIZED' })
  const { page, navigations } = loadSpacePage('SpaceSetting', async () => { throw blocked })
  const markup = fs.readFileSync(path.join(PAGES, 'SpaceSetting', 'index.wxml'), 'utf8')

  await page.onLoad()

  assert.equal(page.data.loading, false)
  assert.equal(page.data.state, '')
  assert.equal(page.data.loadRecovery, 'onboarding')
  assert.match(page.data.loadError, /没有使用权限/)
  assert.match(markup, /wx:elif="\{\{loadError\}\}"/)
  assert.match(markup, /去完成首次设置/)

  page.goOnboarding()
  assert.deepEqual(navigations, ['/pages/Setup/index'])
})

test('空间设置页：空间名与纪念日不合格时不会提交', async () => {
  const { page, apiCalls } = loadSpacePage('SpaceSetting', async () => ({
    state: 'ready',
    user: { displayName: '阿禾', avatarKey: 'cat' },
    partner: { displayName: '小柚' },
    space: { name: '我们的小屋', anniversaryDate: '' },
  }))
  await page.onLoad()

  page.setData({ spaceName: '   ' })
  await page.saveSpace()
  assert.equal(apiCalls.some(call => call.action === 'updateSpace'), false)
  assert.ok(page.data.error, '空间名为空时必须给出提示')

  page.setData({ spaceName: '新名字', anniversaryDate: '2999-01-01' })
  await page.saveSpace()
  assert.equal(apiCalls.some(call => call.action === 'updateSpace'), false)
  assert.match(page.data.error, /不能晚于今天/)

  page.setData({ anniversaryDate: '2024-05-20' })
  await page.saveSpace()
  const updates = apiCalls.filter(call => call.action === 'updateSpace')
  assert.equal(updates.length, 1)
  assert.equal(updates[0].data.name, '新名字')
  assert.equal(updates[0].data.anniversaryDate, '2024-05-20')
  assert.match(page.data.notice, /已保存/)
})

test('空间设置页：重新生成邀请会换掉分享路径', async () => {
  const { page, apiCalls } = loadSpacePage('SpaceSetting', async ({ action }) => {
    if (action === 'getBootstrap') {
      return {
        state: 'ready',
        user: { displayName: '阿禾', avatarKey: 'cat' },
        partner: null,
        space: { name: '我们的小屋', anniversaryDate: '' },
      }
    }
    if (action === 'regenerateInvite') return { inviteToken: 'tok 1/2', expiresAt: '2026-09-18T04:30:00.000Z' }
    return null
  })
  await page.onLoad()
  assert.equal(page.data.sharePath, '/pages/MainPage/index')

  await page.regenerateInvite()
  assert.equal(apiCalls.filter(call => call.action === 'regenerateInvite').length, 1)
  assert.equal(page.data.inviteToken, 'tok 1/2')
  assert.equal(page.data.sharePath, '/pages/Invite/index?inviteToken=tok%201%2F2')
  assert.match(page.data.inviteExpiryText, /前有效/)
  assert.equal(page.onShareAppMessage({ from: 'button' }).path, '/pages/Invite/index?inviteToken=tok%201%2F2')
  assert.equal(page.onShareAppMessage({ from: 'menu' }).path, '/pages/MainPage/index')
  assert.match(page.onShareAppMessage({ from: 'menu' }).title, /不含邀请码/)
})

test('空间设置页：已有伴侣时清除尚未使用的邀请入口，避免分享失效卡片', async () => {
  let partner = null
  const { page, apiCalls } = loadSpacePage('SpaceSetting', async ({ action }) => {
    if (action === 'getBootstrap') return {
      state: 'ready', user: { displayName: '阿禾', avatarKey: 'cat' }, partner,
      space: { name: '我们的小屋', anniversaryDate: '', deletion: null },
    }
    if (action === 'regenerateInvite') return { inviteToken: 'new-token', expiresAt: '2026-09-25T04:30:00.000Z' }
    return null
  })
  await page.onLoad()
  await page.regenerateInvite()
  assert.equal(page.data.inviteToken, 'new-token')
  partner = { displayName: '小柚' }
  await page.loadSpace()
  assert.equal(page.data.inviteToken, '')
  assert.equal(page.data.sharePath, '/pages/MainPage/index')
  await page.regenerateInvite()
  assert.equal(apiCalls.filter(call => call.action === 'regenerateInvite').length, 1)
})

test('空间设置页：单人空间不提供无法完成的离开按钮，并说明安全删除路径', async () => {
  const { page, apiCalls } = loadSpacePage('SpaceSetting', async () => ({
    state: 'ready', user: { displayName: '阿禾', avatarKey: 'cat' }, partner: null,
    space: { name: '一个人的小屋', anniversaryDate: '', deletion: null },
  }))
  await page.onLoad()
  assert.equal(page.data.canLeaveSpace, false)
  await page.unpair()
  assert.equal(apiCalls.some(call => call.action === 'unpair'), false)
  const markup = fs.readFileSync(path.join(PAGES, 'SpaceSetting', 'index.wxml'), 'utf8')
  assert.match(markup, /wx:if="\{\{canLeaveSpace\}\}"[^>]*bindtap="unpair"/)
  assert.match(markup, /最后一名成员/)
})

test('空间设置页：重新进入时刷新对方的注销决定，并可手动刷新', async () => {
  let deletion = null
  const { page } = loadSpacePage('SpaceSetting', async () => ({
    state: 'ready', user: { displayName: '小柚', avatarKey: 'rabbit' },
    partner: { displayName: '阿禾' }, space: { name: '我们的小屋', anniversaryDate: '', deletion },
  }))
  await page.onLoad()
  await page.onShow()
  deletion = { operationId: 'op-fresh', phase: 'awaiting_partner', isRequester: false, canApprove: true, canReject: true }
  await page.onShow()
  assert.equal(page.data.deletionView.mode, 'awaiting-partner')
  deletion = null
  await page.refreshStatus()
  assert.equal(page.data.deletionView.mode, 'normal')
})

test('空间设置页：能从创建结果恢复首次邀请并复制', async () => {
  const { page, clipboards, toasts } = loadSpacePage('SpaceSetting', async () => ({
    state: 'ready',
    user: { displayName: '阿禾', avatarKey: 'cat' },
    partner: null,
    space: { name: '我们的小屋', anniversaryDate: '' },
  }))
  await page.onLoad({ inviteToken: 'tok 1/2', expiresAt: '2026-09-21T04:30:00.000Z' })
  assert.equal(page.data.inviteToken, 'tok 1/2')
  assert.equal(page.data.sharePath, '/pages/Invite/index?inviteToken=tok%201%2F2')
  assert.match(page.data.inviteExpiryText, /前有效/)
  await page.copyInvite()
  assert.deepEqual(clipboards, ['tok 1/2'])
  assert.equal(page.data.copyState, 'success')
  assert.equal(toasts.some(item => /已复制/.test(item.title)), false, '微信已有原生复制提示，不应再叠加 Toast')
})

test('配对页：服务端要求补资料时保留邀请码并回首次设置', async () => {
  const { page, apiCalls, navigations } = loadSpacePage('Invite', async ({ action }) => {
    if (action === 'getInvite') return { status: 'valid', spaceName: '示例空间', inviterName: '小柚' }
    if (action === 'joinSpace') {
      throw Object.assign(new Error('请先完成昵称和头像设置'), { code: 'PROFILE_REQUIRED' })
    }
    return null
  })
  await page.onLoad({ inviteToken: 'tok-1' })
  await page.confirmJoin()

  assert.equal(apiCalls.filter(call => call.action === 'getInvite').length, 1, '资料错误后不应刷新并清掉错误')
  assert.equal(navigations.at(-1), '/pages/Setup/index?inviteToken=tok-1')
  assert.match(page.data.error, /昵称|头像|资料/)
})

test('配对页：服务端要求补身份确认时也保留邀请码并回首次设置', async () => {
  const { page, apiCalls, navigations } = loadSpacePage('Invite', async ({ action }) => {
    if (action === 'getInvite') return { status: 'valid', spaceName: '示例空间', inviterName: '小柚' }
    if (action === 'joinSpace') {
      throw Object.assign(new Error('请先确认使用当前微信身份'), { code: 'IDENTITY_NOTICE_REQUIRED' })
    }
    return null
  })
  await page.onLoad({ inviteToken: 'tok-identity' })
  await page.confirmJoin()

  assert.equal(apiCalls.filter(call => call.action === 'getInvite').length, 1)
  assert.equal(navigations.at(-1), '/pages/Setup/index?inviteToken=tok-identity')
  assert.match(page.data.error, /微信身份/)
})

test('空间设置页：剪贴板失败时不伪报成功', async () => {
  const { page, toasts } = loadSpacePage('SpaceSetting', async () => ({
    state: 'ready',
    user: { displayName: '阿禾', avatarKey: 'cat' },
    partner: null,
    space: { name: '我们的小屋', anniversaryDate: '' },
  }), { clipboardFail: true, clipboardError: 'setClipboardData:fail api scope is not declared' })
  await page.onLoad({ inviteToken: 'tok-1' })
  await page.copyInvite()
  assert.equal(page.data.copyState, 'manual')
  assert.match(page.data.copyError, /scope|授权|手动复制/i)
  assert.equal(page.data.inviteToken, 'tok-1')
})

test('空间设置页：剪贴板 API 缺失或抛异常时进入手动复制兜底', async () => {
  for (const options of [{ clipboardMissing: true }, { clipboardThrow: true }]) {
    const { page } = loadSpacePage('SpaceSetting', async () => ({
      state: 'ready',
      user: { displayName: '阿禾', avatarKey: 'cat' },
      partner: null,
      space: { name: '我们的小屋', anniversaryDate: '' },
    }), options)
    await page.onLoad({ inviteToken: 'tok-1' })
    await page.copyInvite()
    assert.equal(page.data.copyState, 'manual')
    assert.match(page.data.copyError, /手动复制|暂时不可用/)
  }
})

test('空间设置页：取消确认就不会发出解除或删除请求', async () => {
  const { page, apiCalls, modals } = loadSpacePage('SpaceSetting', async () => ({
    state: 'ready',
    user: { displayName: '阿禾', avatarKey: 'cat' },
    partner: { displayName: '小柚' },
    space: { name: '我们的小屋', anniversaryDate: '' },
  }), { modalConfirm: false })
  await page.onLoad()

  await page.unpair()
  await page.requestDeletion()

  assert.equal(apiCalls.some(call => call.action === 'unpair'), false)
  assert.equal(apiCalls.some(call => call.action === 'requestSpaceDeletion'), false)
  assert.equal(modals.length, 2, '解除配对与删除申请都应先弹确认框，取消后立刻停下')
})

test('空间设置页：同意后若清理未启动仍可撤销并恢复', async () => {
  let bootstrap = {
    state: 'ready',
    user: { displayName: '小柚', avatarKey: 'rabbit' },
    partner: { displayName: '阿禾' },
    space: {
      name: '我们的小屋',
      anniversaryDate: '',
      deletion: { operationId: 'op-page', phase: 'awaiting_partner', isRequester: false, canApprove: true, canReject: true, canCancel: false },
    },
  }
  const { page, apiCalls } = loadSpacePage('SpaceSetting', async ({ action }) => {
    if (action === 'approveSpaceDeletion') {
      bootstrap = {
        ...bootstrap,
        state: 'deleting',
        space: {
          ...bootstrap.space,
          deletion: { operationId: 'op-page', phase: 'cooldown', canCancel: true, canFinalize: true, cooldownEndsAt: '2026-09-21T04:00:00.000Z' },
        },
      }
      return bootstrap.space.deletion
    }
    if (action === 'cancelSpaceDeletion') {
      bootstrap = { ...bootstrap, state: 'ready', space: { ...bootstrap.space, deletion: null } }
      return { phase: 'none' }
    }
    if (action === 'getBootstrap') {
      return bootstrap
    }
    if (action === 'startSpacePurge') throw new Error('模拟启动清理失败')
    return null
  })
  await page.onLoad()
  assert.equal(page.data.deletionView.mode, 'awaiting-partner')

  await page.approveDeletion()
  assert.equal(apiCalls.filter(call => call.action === 'approveSpaceDeletion').length, 1)
  assert.equal(apiCalls.find(call => call.action === 'approveSpaceDeletion').data.operationId, 'op-page')
  assert.equal(page.data.deletionView.mode, 'ready-to-purge')
  assert.match(page.data.error, /模拟启动清理失败/)

  await page.cancelDeletion()
  assert.equal(apiCalls.filter(call => call.action === 'cancelSpaceDeletion').length, 1)
  assert.equal(apiCalls.find(call => call.action === 'cancelSpaceDeletion').data.operationId, 'op-page')
  assert.equal(page.data.deletionView.mode, 'normal')
})

test('撤销响应丢失但云端已恢复时会重新读取状态，不误报失败', async () => {
  let cancelled = false
  const { page, apiCalls } = loadSpacePage('SpaceSetting', async ({ action }) => {
    if (action === 'getBootstrap') return {
      state: 'ready',
      user: { displayName: '阿禾', avatarKey: 'cat' },
      partner: { displayName: '小柚' },
      space: {
        name: '我们的小屋',
        anniversaryDate: '',
        deletion: cancelled ? null : {
          operationId: 'op-cancel-recovery', phase: 'awaiting_partner',
          isRequester: true, canCancel: true,
        },
      },
    }
    if (action === 'cancelSpaceDeletion') {
      cancelled = true
      throw new Error('服务器暂时不可用，请稍后重试')
    }
    return null
  })
  await page.onLoad()

  await page.cancelDeletion()

  assert.equal(apiCalls.filter(call => call.action === 'cancelSpaceDeletion').length, 1)
  assert.equal(apiCalls.filter(call => call.action === 'getBootstrap').length, 2)
  assert.equal(page.data.deletionView.mode, 'normal')
  assert.equal(page.data.error, '')
  assert.match(page.data.notice, /已撤销|已恢复/)
})

test('注销状态：不再显示旧的冷静期时间，等待同意时仍说明撤销', () => {
  const base = { state: 'deleting', space: { deletion: {
    phase: 'cooldown', canFinalize: false, cooldownEndsAt: '2026-09-25T04:00:00.000Z',
  } } }
  const cooldown = space.deletionView(base)
  assert.doesNotMatch(cooldown.message, /2026-09-25|冷静期/)
  const awaiting = space.deletionView({ state: 'ready', space: { deletion: {
    phase: 'awaiting_partner', isRequester: true,
  } } })
  assert.match(awaiting.message, /打开小程序|空间设置/)
  assert.match(awaiting.message, /撤销/)
})

test('空间设置页：旧版卡住状态可以恢复，最终删除会启动并继续清理', async () => {
  let bootstrap = {
    state: 'deleting',
    user: { displayName: '阿禾', avatarKey: 'cat' },
    partner: { displayName: '小柚' },
    space: { name: '我们的小屋', anniversaryDate: '', deletion: { phase: 'legacy', canRestore: true } },
  }
  let purgeCalls = 0
  const { page, apiCalls, navigations } = loadSpacePage('SpaceSetting', async ({ action }) => {
    if (action === 'getBootstrap') return bootstrap
    if (action === 'restoreLegacyDeletingSpace') {
      bootstrap = { ...bootstrap, state: 'ready', space: { ...bootstrap.space, deletion: null } }
      return { phase: 'none' }
    }
    if (action === 'startSpacePurge') return { phase: 'purging', progress: { removedCount: 0 } }
    if (action === 'continueSpacePurge') {
      purgeCalls += 1
      return purgeCalls === 1
        ? { phase: 'purging', progress: { removedCount: 4 } }
        : { phase: 'complete', completed: true }
    }
    return null
  })

  await page.onLoad()
  assert.equal(page.data.deletionView.mode, 'legacy')
  await page.restoreLegacyDeletion()
  assert.equal(apiCalls.filter(call => call.action === 'restoreLegacyDeletingSpace').length, 1)
  assert.equal(page.data.deletionView.mode, 'normal')

  bootstrap = {
    ...bootstrap,
    state: 'deleting',
    space: { ...bootstrap.space, deletion: { operationId: 'op-purge', phase: 'cooldown', canFinalize: true, canCancel: true, cooldownEndsAt: '2026-09-20T04:00:00.000Z' } },
  }
  await page.loadSpace()
  assert.equal(page.data.deletionView.mode, 'ready-to-purge')
  await page.finalizeDeletion()
  assert.equal(apiCalls.filter(call => call.action === 'startSpacePurge').length, 1)
  assert.equal(apiCalls.filter(call => call.action === 'continueSpacePurge').length, 2)
  assert.equal(apiCalls.find(call => call.action === 'startSpacePurge').data.operationId, 'op-purge')
  assert.equal(apiCalls.find(call => call.action === 'continueSpacePurge').data.operationId, 'op-purge')
  assert.equal(apiCalls.find(call => call.action === 'continueSpacePurge').data.diagnostic, undefined)
  assert.equal(navigations.at(-1), '/pages/MainPage/index')
})

test('空间设置页：发起注销仍保留双重确认，但申请阶段不会声称已冻结', async () => {
  const { page, apiCalls, modals } = loadSpacePage('SpaceSetting', async ({ action }) => {
    if (action === 'getBootstrap') return {
      state: 'ready',
      user: { displayName: '阿禾', avatarKey: 'cat' },
      partner: { displayName: '小柚' },
      space: { name: '我们的小屋', anniversaryDate: '', deletion: null },
    }
    if (action === 'requestSpaceDeletion') return { phase: 'awaiting_partner' }
    return null
  })
  await page.onLoad()

  await page.requestDeletion()
  assert.equal(modals.length, 2)
  assert.equal(apiCalls.filter(call => call.action === 'requestSpaceDeletion').length, 1)
  assert.match(page.data.notice, /等待对方确认/)
  assert.doesNotMatch(page.data.notice, /已冻结/)
})

test('空间清理中断时提示进度已保存并保留继续入口', async () => {
  const { page } = loadSpacePage('SpaceSetting', async ({ action }) => {
    if (action === 'getBootstrap') return {
      state: 'deleting', user: { displayName: '阿禾', avatarKey: 'cat' }, partner: null,
      space: { name: '我的小屋', deletion: { operationId: 'op-retry', phase: 'purging', progress: { removedCount: 5 } } },
    }
    if (action === 'continueSpacePurge') throw new Error('服务器异常（DELETE_CLOUD_FILE/FILE_DELETE_FAILED/Error）')
    return null
  })
  await page.onLoad()
  await page.continuePurge()
  assert.match(page.data.notice, /进度已保存/)
  assert.match(page.data.error, /DELETE_CLOUD_FILE/)
  assert.equal(page.data.deletionView.mode, 'purging')
})

test('单人空间两次确认后立即开始并完成分批清理', async () => {
  let bootstrap = {
    state: 'ready', user: { displayName: '阿禾', avatarKey: 'cat' }, partner: null,
    space: { name: '我的小屋', anniversaryDate: '', deletion: null },
  }
  const { page, apiCalls, modals, navigations } = loadSpacePage('SpaceSetting', async ({ action }) => {
    if (action === 'getBootstrap') return bootstrap
    if (action === 'requestSpaceDeletion') return { phase: 'cooldown', operationId: 'solo-op', canFinalize: true }
    if (action === 'startSpacePurge') return { phase: 'purging' }
    if (action === 'continueSpacePurge') return { phase: 'complete', completed: true }
    return null
  })
  await page.onLoad()
  await page.requestDeletion()
  assert.equal(modals.length, 2)
  assert.deepEqual(apiCalls.filter(call => call.action !== 'getBootstrap').map(call => call.action), [
    'requestSpaceDeletion', 'startSpacePurge', 'continueSpacePurge',
  ])
  assert.equal(apiCalls.find(call => call.action === 'startSpacePurge').data.operationId, 'solo-op')
  assert.equal(apiCalls.find(call => call.action === 'requestSpaceDeletion').data, undefined)
  assert.equal(navigations.at(-1), '/pages/MainPage/index')
})

test('注销申请响应失败但云端已保存时重新读取状态，不让单人空间卡在服务器繁忙', async () => {
  let saved = false
  const { page, apiCalls } = loadSpacePage('SpaceSetting', async ({ action }) => {
    if (action === 'getBootstrap') return saved
      ? { state: 'deleting', user: { displayName: '阿禾', avatarKey: 'cat' }, partner: null,
        space: { name: '我的小屋', deletion: { operationId: 'recovered-op', phase: 'cooldown', canFinalize: true, canCancel: true } } }
      : { state: 'ready', user: { displayName: '阿禾', avatarKey: 'cat' }, partner: null,
        space: { name: '我的小屋', deletion: null } }
    if (action === 'requestSpaceDeletion') {
      saved = true
      throw new Error('服务器暂时不可用，请稍后重试')
    }
    return null
  })
  await page.onLoad()
  await page.requestDeletion()
  assert.equal(apiCalls.filter(call => call.action === 'getBootstrap').length, 2)
  assert.equal(page.data.deletionView.mode, 'ready-to-purge')
  assert.match(page.data.error, /已保存|继续处理/)
})

test('双人空间需对方再次确认两次才会启动清理', async () => {
  const bootstrap = {
    state: 'ready', user: { displayName: '小柚', avatarKey: 'rabbit' }, partner: { displayName: '阿禾' },
    space: { name: '我们的小屋', anniversaryDate: '', deletion: { operationId: 'paired-op', phase: 'awaiting_partner', canApprove: true } },
  }
  const { page, apiCalls, modals } = loadSpacePage('SpaceSetting', async ({ action }) => {
    if (action === 'getBootstrap') return bootstrap
    if (action === 'approveSpaceDeletion') return { phase: 'cooldown', operationId: 'paired-op', canFinalize: true }
    if (action === 'startSpacePurge') return { phase: 'purging' }
    if (action === 'continueSpacePurge') return { phase: 'complete', completed: true }
    return null
  })
  await page.onLoad()
  await page.approveDeletion()
  assert.equal(modals.length, 2)
  assert.deepEqual(apiCalls.filter(call => call.action !== 'getBootstrap').map(call => call.action), [
    'approveSpaceDeletion', 'startSpacePurge', 'continueSpacePurge',
  ])
})

test('首页：未配对直达时回欢迎页重新分流', async () => {
  const { page, navigations } = loadMainPage(async ({ action }) => {
    if (action === 'getBootstrap') {
      return { state: 'unpaired', user: { displayName: '阿禾', avatarKey: 'cat', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true }, partner: null, space: null }
    }
    throw new Error('未配对时不应该继续读业务数据')
  })
  await page.onShow()
  assert.deepEqual(navigations, ['/pages/Welcome/index'])
  assert.equal(page.data.setupMessage, '')
})

test('首页：空间冻结直达时回欢迎页重新分流', async () => {
  const { page, navigations } = loadMainPage(async ({ action }) => {
    if (action === 'getBootstrap') {
      return { state: 'frozen', user: { displayName: '阿禾', avatarKey: 'cat', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true }, partner: { displayName: '小柚' }, space: { name: '我们的小屋' } }
    }
    throw new Error('冻结时不应该继续读业务数据')
  })
  await page.onShow()
  assert.deepEqual(navigations, ['/pages/Welcome/index'])
  assert.equal(page.data.setupMessage, '')
})

test('首页：空间只有创建者时进入邀请设置，不渲染半成品首页', async () => {
  const { page, navigations } = loadMainPage(async ({ action }) => {
    if (action === 'getBootstrap') {
      return {
        state: 'ready',
        user: { openid: 'a', displayName: '阿禾', avatarKey: 'cat', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true },
        partner: null,
        space: { _id: 'space-a', name: '阿禾的小屋', anniversaryDate: '', status: 'active' },
        features: {},
      }
    }
    throw new Error('单人空间不应该继续读取首页业务数据')
  })

  await page.onShow()
  assert.deepEqual(navigations, ['/pages/Welcome/index'])
  assert.equal(page.data.setupMessage, '')
})

test('首页：拿到完整 bootstrap 后渲染成员信息，不再依赖旧身份模型', async () => {
  const { page, navigations } = loadMainPage(async ({ action }) => {
    if (action === 'getBootstrap') {
      return {
        state: 'ready',
        user: { openid: 'a', displayName: '阿禾', avatarKey: 'cat', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true, credit: 12, canEditMood: true, canSyncSteps: true },
        partner: { openid: 'b', displayName: '小柚', avatarKey: 'rabbit', credit: 34, canEditMood: false, canSyncSteps: false },
        space: { _id: 'space-ab', name: '我们的小屋', anniversaryDate: '', status: 'active' },
        features: { schedule: false, dinner: true, records: true, xiaoba: true },
      }
    }
    if (action === 'getHouseRules') return { callerOpenid: 'a', items: [] }
    return null
  })
  await page.onShow()
  assert.deepEqual(navigations, [])
  assert.equal(page.data.mine.name, '阿禾')
  assert.equal(page.data.mine.credit, 12)
  assert.equal(page.data.partner.name, '小柚')
  assert.equal(page.data.partner.credit, 34)
  assert.equal(page.data.setupMessage, '')
})

test('首页：云端返回的形状不完整时回欢迎页，不渲染残缺内容', async () => {
  const { page, navigations } = loadMainPage(async ({ action }) => {
    if (action === 'getBootstrap') return { ok: true, data: '旧版返回' }
    return null
  })
  await page.onShow()
  assert.deepEqual(navigations, ['/pages/Welcome/index'])
  assert.equal(page.data.setupMessage, '')
})

test('首页直达遇到 bootstrap 失败时回欢迎页而不是展示残缺首页', async () => {
  const { page, navigations } = loadMainPage(async () => { throw new Error('offline') })

  await page.onShow()

  assert.deepEqual(navigations, ['/pages/Welcome/index'])
  assert.equal(page.data.setupMessage, '')
})

test('欢迎页是默认入口，空间流程与隐藏审核页均已注册', () => {
  const config = JSON.parse(fs.readFileSync(path.join(MINI_PROGRAM, 'app.json'), 'utf8'))
  const newPages = ['pages/Welcome/index', 'pages/Setup/index', 'pages/Invite/index', 'pages/SpaceSetting/index', 'pages/ReviewEntry/index']
  for (const pagePath of newPages) {
    assert.ok(config.pages.includes(pagePath), `${pagePath} 未在 app.json 注册`)
    for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
      assert.ok(
        fs.existsSync(path.join(MINI_PROGRAM, `${pagePath}${ext}`)),
        `${pagePath}${ext} 缺失`,
      )
    }
    assert.match(readPageSource(path.basename(path.dirname(pagePath))), /onShareAppMessage\s*\(/)
    assert.doesNotMatch(readPageSource(path.basename(path.dirname(pagePath))), /wx\.cloud\.callFunction/)
  }
  assert.equal(config.pages[0], 'pages/Welcome/index')
  const normalMarkup = ['Welcome', 'Setup', 'MainPage', 'SpaceSetting']
    .map(name => fs.readFileSync(path.join(PAGES, name, 'index.wxml'), 'utf8'))
    .join('\n')
  assert.doesNotMatch(normalMarkup, /ReviewEntry|先看看效果|审核体验入口/)
})

test('空间流程提供邀请码备用入口且保留微信分享', () => {
  const setupMarkup = fs.readFileSync(path.join(PAGES, 'Setup', 'index.wxml'), 'utf8')
  const settingsMarkup = fs.readFileSync(path.join(PAGES, 'SpaceSetting', 'index.wxml'), 'utf8')
  assert.match(setupMarkup, /step === 'join'/)
  assert.match(setupMarkup, /bindinput="setJoinInviteToken"/)
  assert.match(setupMarkup, /bindtap="submitJoin"/)
  assert.match(settingsMarkup, /bindtap="copyInvite"/)
  assert.match(settingsMarkup, /user-select="true"/)
  assert.match(settingsMarkup, /copyState === 'manual'/)
  assert.match(settingsMarkup, /space-copy-fallback/)
  assert.match(settingsMarkup, /open-type="share"/)
})

test('新增的空间流程文件不含真实姓名与私人日期', () => {
  const files = [
    'utils/space.js',
    'utils/space-preview.js',
    'pages/Setup/index.js',
    'pages/Setup/index.wxml',
    'pages/Invite/index.js',
    'pages/Invite/index.wxml',
    'pages/SpaceSetting/index.js',
    'pages/SpaceSetting/index.wxml',
  ]
  const text = files.map(file => fs.readFileSync(path.join(MINI_PROGRAM, file), 'utf8')).join('\n')
  assert.doesNotMatch(text, /PRIVATE_MARKER_42/)
})
