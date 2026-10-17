const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const appearanceUtils = require('../miniprogram/utils/appearance.js')

const pageRoot = path.join(__dirname, '../miniprogram/pages/MainPage')

function applyPatch(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split('.')
    let cursor = target
    while (parts.length > 1) {
      const part = parts.shift()
      cursor[part] = cursor[part] || {}
      cursor = cursor[part]
    }
    cursor[parts[0]] = value
  }
}

function loadHome({ replace, reset } = {}) {
  let page
  const toasts = []
  const navigations = []
  const uploader = {
    replace: replace || (async target => ({
      ...target,
      imageFileId: `cloud://${target.kind}-${target.slot || 'mine'}`,
      imageUrl: `https://shared.example/${target.kind}-${target.slot || 'mine'}.jpg`,
    })),
    reset: reset || (async target => ({ ...target, imageFileId: '' })),
  }
  const app = {
    ensureWritable: () => true,
    spaceUploadPath: async folder => `couples/test-space/${folder}/image.jpg`,
    cloud: () => ({ uploadFile: async () => ({ fileID: 'cloud://uploaded' }) }),
    api: async () => ({}),
  }
  vm.runInNewContext(fs.readFileSync(path.join(pageRoot, 'index.js'), 'utf8'), {
    Page: value => { page = value },
    getApp: () => app,
    require: filename => {
      if (filename === '../../utils/share.js') return { getShareMessage: () => ({}) }
      if (filename === '../../utils/anniversary.js') return { formatAnniversaryDate: () => '', getAnniversaryDay: () => 1 }
      if (filename === '../../utils/subscriptions.js') return { getPartnerReminderStatus: async () => ({}) }
      if (filename === '../../utils/space.js') return { resolveEntry: () => ({ kind: 'home' }) }
      if (filename === '../../utils/appearance.js') {
        return { ...appearanceUtils, createAppearanceUploader: () => uploader }
      }
      assert.fail(`unexpected dependency: ${filename}`)
    },
    wx: {
      showToast: value => toasts.push(value),
      navigateTo: value => navigations.push(value.url),
      getStorageSync: () => ({}),
      setStorageSync() {},
    },
    console: { warn() {}, error() {} },
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
  })
  page.setData = patch => applyPatch(page.data, patch)
  return { page, toasts, navigations }
}

function bootstrap(overrides = {}) {
  return {
    user: {
      openid: 'user-a', displayName: '小禾', avatarKey: 'cat', avatarFileId: 'cloud://user-a-avatar',
      avatarUrl: 'https://shared.example/user-a-avatar.jpg',
      credit: 12, canEditMood: true, canSyncSteps: true,
    },
    partner: {
      openid: 'user-b', displayName: '小柚', avatarKey: 'rabbit', avatarFileId: 'cloud://user-b-avatar',
      avatarUrl: 'https://shared.example/user-b-avatar.jpg',
      credit: 18, canEditMood: false, canSyncSteps: false,
    },
    space: {
      _id: 'space-example', name: '示例空间', anniversaryDate: '2025-01-02',
      appearance: {
        heroImageFileId: 'cloud://hero', anniversaryImageFileId: 'cloud://anniversary',
        rulesImageFileId: 'cloud://rules', welcomeImageFileId: 'cloud://welcome',
        missionImageFileId: 'cloud://mission', marketImageFileId: 'cloud://market',
        recordsImageFileId: 'cloud://records', dinnerImageFileId: 'cloud://dinner',
        storageImageFileId: 'cloud://storage',
        heroImageUrl: 'https://shared.example/hero.jpg',
        anniversaryImageUrl: 'https://shared.example/anniversary.jpg',
        rulesImageUrl: 'https://shared.example/rules.jpg',
        welcomeImageUrl: 'https://shared.example/welcome.jpg',
        missionImageUrl: 'https://shared.example/mission.jpg',
        marketImageUrl: 'https://shared.example/market.jpg',
        recordsImageUrl: 'https://shared.example/records.jpg',
        dinnerImageUrl: 'https://shared.example/dinner.jpg',
        storageImageUrl: 'https://shared.example/storage.jpg',
      },
    },
    features: { schedule: true },
    ...overrides,
  }
}

test('主页把九个共享图片位、我的头像入口和课表开关接到界面', () => {
  const markup = fs.readFileSync(path.join(pageRoot, 'index.wxml'), 'utf8')
  const style = fs.readFileSync(path.join(pageRoot, 'index.wxss'), 'utf8')

  for (const key of ['hero', 'anniversary', 'rules', 'welcome', 'mission', 'market', 'records', 'dinner', 'storage']) {
    assert.match(markup, new RegExp(`appearance\\.${key}`))
    assert.match(markup, new RegExp(`data-slot="${key}"`))
  }
  assert.match(markup, /装扮我们的小屋/)
  assert.match(markup, /首页装扮/)
  assert.match(markup, /页面主题/)
  assert.match(markup, /我的头像/)
  assert.doesNotMatch(markup, /修改对方头像/)
  assert.match(markup, /wx:if="\{\{hasSchedule\}\}"[^>]*class="section-block schedule-feature"/)
  assert.match(style, /\.appearance-sheet\s*\{/)
  assert.match(style, /\.appearance-grid\s*\{/)
})

test('主页按服务端数据展示双方头像和共享装饰图', () => {
  const { page } = loadHome()
  page.renderBootstrap(bootstrap())

  assert.equal(page.data.mine.avatar.imageFileId, 'https://shared.example/user-a-avatar.jpg')
  assert.equal(page.data.partner.avatar.imageFileId, 'https://shared.example/user-b-avatar.jpg')
  assert.equal(page.data.appearance.hero, 'https://shared.example/hero.jpg')
  assert.equal(page.data.appearance.anniversary, 'https://shared.example/anniversary.jpg')
  assert.equal(page.data.appearance.rules, 'https://shared.example/rules.jpg')
  assert.equal(page.data.appearance.welcome, 'https://shared.example/welcome.jpg')
  assert.equal(page.data.appearance.mission, 'https://shared.example/mission.jpg')
  assert.equal(page.data.appearance.market, 'https://shared.example/market.jpg')
  assert.equal(page.data.appearance.records, 'https://shared.example/records.jpg')
  assert.equal(page.data.appearance.dinner, 'https://shared.example/dinner.jpg')
  assert.equal(page.data.appearance.storage, 'https://shared.example/storage.jpg')
})

test('选择新图后直接替换共享装饰，并提示对方也能看到', async () => {
  const { page, toasts } = loadHome()
  page.renderBootstrap(bootstrap())
  page.openAppearancePanel()
  await page.replaceAppearance({ currentTarget: { dataset: { slot: 'hero' } } })

  assert.equal(page.data.appearance.hero, 'https://shared.example/space-hero.jpg')
  assert.equal(page.data.appearanceOpen, true)
  assert.equal(page.data.appearanceBusy, false)
  assert.equal(toasts.at(-1).title, '已换好，对方也能看到')
})

test('更换头像只更新当前用户；上传失败时保留旧图', async () => {
  const failed = loadHome({ replace: async () => { throw new Error('图片不合适') } })
  failed.page.renderBootstrap(bootstrap())
  await failed.page.replaceMyAvatar()
  assert.equal(failed.page.data.mine.avatar.imageFileId, 'https://shared.example/user-a-avatar.jpg')
  assert.equal(failed.page.data.partner.avatar.imageFileId, 'https://shared.example/user-b-avatar.jpg')
  assert.equal(failed.toasts.at(-1).title, '图片不合适')

  const ok = loadHome()
  ok.page.renderBootstrap(bootstrap())
  await ok.page.replaceMyAvatar()
  assert.equal(ok.page.data.mine.avatar.imageFileId, 'https://shared.example/avatar-mine.jpg')
  assert.equal(ok.page.data.partner.avatar.imageFileId, 'https://shared.example/user-b-avatar.jpg')
})

test('关闭课表的空间既不渲染入口，也无法从方法绕过', () => {
  const { page, toasts, navigations } = loadHome()
  page.renderBootstrap(bootstrap({ features: { schedule: false } }))
  page.openSchedule()

  assert.equal(page.data.hasSchedule, false)
  assert.deepEqual(navigations, [])
  assert.equal(toasts.at(-1).title, '双人课表暂未开放')
})
