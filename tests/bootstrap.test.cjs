const test = require('node:test')
const assert = require('node:assert/strict')

const { MemoryStore, emptyWorld, isoAt, pairedSpace } = require('./helpers/memory-store.cjs')
const { createService } = require('../cloudfunctions/api/service.js')
const { isBootstrap, SPACE_STATES } = require('../miniprogram/utils/space.js')

function serviceFor(store, asked = [], options = {}) {
  const ask = async (messages, context) => { asked.push(context); return { reply: '', model: 'test' } }
  return createService(store, () => isoAt(), ask, options)
}

test('新账号第一次调用 getBootstrap 只返回临时状态，不静默建号', async () => {
  const store = new MemoryStore(emptyWorld())
  const service = serviceFor(store)

  const bootstrap = await service.execute('getBootstrap', {}, 'newcomer')

  assert.equal(bootstrap.state, 'unpaired')
  assert.equal(bootstrap.partner, null)
  assert.equal(bootstrap.space, null)
  assert.equal(isBootstrap(bootstrap), true, 'bootstrap 形状必须能被客户端校验通过')
  assert.equal(bootstrap.user.openid, 'newcomer')
  assert.equal(bootstrap.user.credit, 0)
  assert.equal(bootstrap.user.avatarKey, 'cat')
  assert.equal(bootstrap.user.displayName, '我')
  assert.equal(bootstrap.user.profileComplete, false, '展示兜底“我”不能冒充已完成资料')
  assert.equal(bootstrap.user.identityNoticeRequired, true)
  assert.equal(bootstrap.user.onboardingComplete, false)
  assert.equal(bootstrap.user.canEditMood, true)
  assert.equal(bootstrap.user.canSyncSteps, true)

  assert.equal(store.data.UserList.length, 0)
})

test('用户明确确认身份并保存资料时才创建账号', async () => {
  class DocumentOnlyTransactionStore extends MemoryStore {
    async runTransaction(callback) {
      return super.runTransaction(draft => callback(new Proxy(draft, {
        get(target, property) {
          if (property === 'findOne' || property === 'findMany') {
            return async () => { throw new Error('transactions do not support where queries') }
          }
          const value = target[property]
          return typeof value === 'function' ? value.bind(target) : value
        },
      })))
    }
  }

  const store = new DocumentOnlyTransactionStore(emptyWorld())
  const service = serviceFor(store)
  await service.execute('getBootstrap', {}, 'newcomer')
  await service.execute('updateProfile', {
    displayName: '阿禾', avatarKey: 'cat', identityNoticeAccepted: true,
  }, 'newcomer')

  assert.equal(store.data.UserList.length, 1)
  assert.equal(store.data.UserList[0]._openid, 'newcomer')
  assert.equal(store.data.UserList[0].displayName, '阿禾')
})

test('重复首次注册不会用默认值覆盖已经保存的资料', async () => {
  const store = new MemoryStore(emptyWorld())
  const service = serviceFor(store)
  await service.execute('updateProfile', { displayName: '小禾', avatarKey: 'fox', identityNoticeAccepted: true }, 'newcomer')
  await Promise.all([
    service.execute('getBootstrap', {}, 'newcomer'),
    service.execute('getBootstrap', {}, 'newcomer'),
  ])
  assert.equal(store.data.UserList.length, 1)
  assert.equal(store.data.UserList[0].displayName, '小禾')
  assert.equal(store.data.UserList[0].avatarKey, 'fox')
})

test('getBootstrap 的 features 默认值与设计稿一致', async () => {
  const service = serviceFor(new MemoryStore(emptyWorld()))
  const bootstrap = await service.execute('getBootstrap', {}, 'newcomer')

  assert.deepEqual(bootstrap.features, { schedule: false, dinner: true, records: true, xiaoba: true })
})

test('已配对空间返回 ready 与双方视图，权限由服务端判定', async () => {
  const store = new MemoryStore(pairedSpace())
  const service = serviceFor(store)

  const bootstrap = await service.execute('getBootstrap', {}, 'a')

  assert.equal(isBootstrap(bootstrap), true)
  assert.equal(bootstrap.state, 'ready')
  assert.equal(bootstrap.user.openid, 'a')
  assert.equal(bootstrap.user.displayName, '阿禾')
  assert.equal(bootstrap.user.identityNoticeRequired, false, '迁移来的老账号不应突然重复弹首次说明')
  assert.equal(bootstrap.user.onboardingComplete, true)
  assert.equal(bootstrap.user.avatarKey, 'cat')
  assert.equal(bootstrap.user.credit, 10)
  assert.equal(bootstrap.user.canEditMood, true)
  assert.equal(bootstrap.user.canSyncSteps, true)

  assert.equal(bootstrap.partner.openid, 'b')
  assert.equal(bootstrap.partner.displayName, '小柚')
  assert.equal(bootstrap.partner.avatarKey, 'rabbit')
  assert.equal(bootstrap.partner.credit, 5)
  assert.equal(bootstrap.partner.canEditMood, false, '伴侣的心情不能由我改')
  assert.equal(bootstrap.partner.canSyncSteps, false, '伴侣的步数不能由我同步')

  assert.deepEqual(bootstrap.space, {
    _id: 'space-1', name: '测试空间', anniversaryDate: '', status: 'active', deletion: null,
    appearance: {
      heroImageFileId: '', anniversaryImageFileId: '', rulesImageFileId: '', welcomeImageFileId: '',
      missionImageFileId: '', marketImageFileId: '', recordsImageFileId: '', dinnerImageFileId: '', storageImageFileId: '',
    },
  })
  assert.equal(bootstrap.user.avatarFileId, '')
  assert.equal(bootstrap.partner.avatarFileId, '')
})

test('站在伴侣视角拿到的 bootstrap 是镜像的', async () => {
  const service = serviceFor(new MemoryStore(pairedSpace()))
  const bootstrap = await service.execute('getBootstrap', {}, 'b')

  assert.equal(bootstrap.user.openid, 'b')
  assert.equal(bootstrap.user.canEditMood, true)
  assert.equal(bootstrap.partner.openid, 'a')
  assert.equal(bootstrap.partner.canEditMood, false)
})

test('部署未开放课表时，即使空间残留开关也保持关闭', async () => {
  const data = pairedSpace()
  data.CoupleSpaceList[0].featureFlags = { schedule: true, dinner: false, records: true, xiaoba: false }
  const service = serviceFor(new MemoryStore(data))

  const bootstrap = await service.execute('getBootstrap', {}, 'a')
  assert.deepEqual(bootstrap.features, { schedule: false, dinner: false, records: true, xiaoba: false })
})

test('部署开启后向任意空间下发课表能力，空间自身可将其关闭', async () => {
  const data = pairedSpace()
  data.CoupleSpaceList[0].featureFlags = { schedule: true }
  const service = serviceFor(new MemoryStore(data), [], { capabilities: { schedule: true, xiaoba: true } })

  const bootstrap = await service.execute('getBootstrap', {}, 'a')
  assert.equal(bootstrap.features.schedule, true)

  data.CoupleSpaceList[0].featureFlags.schedule = false
  const disabled = serviceFor(new MemoryStore(data), [], { capabilities: { schedule: true, xiaoba: true } })
  assert.equal((await disabled.execute('getBootstrap', {}, 'a')).features.schedule, false)
})

test('空间自身的功能开关不能绕过部署级小八开关', async () => {
  const data = pairedSpace()
  data.CoupleSpaceList[0].featureFlags = { xiaoba: true }
  const service = serviceFor(new MemoryStore(data), [], { capabilities: { schedule: false, xiaoba: false } })

  const bootstrap = await service.execute('getBootstrap', {}, 'a')
  assert.equal(bootstrap.features.xiaoba, false)
  await assert.rejects(
    () => service.execute('askXiaoBa', { aiConsent: true, messages: [{ role: 'user', content: '你好' }] }, 'a'),
    error => error.code === 'XIAOBA_UNAVAILABLE',
  )
})

test('只创建了空间、还没人加入时 partner 为 null，但状态仍是 ready', async () => {
  const store = new MemoryStore(emptyWorld())
  const service = serviceFor(store)

  await service.execute('getBootstrap', {}, 'a')
  await service.execute('updateProfile', { displayName: '阿禾', avatarKey: 'fox', identityNoticeAccepted: true }, 'a')
  const created = await service.execute('createSpace', { name: '我们的空间', anniversaryDate: '2026-05-20' }, 'a')
  assert.ok(created.spaceId)

  const bootstrap = await service.execute('getBootstrap', {}, 'a')
  assert.equal(isBootstrap(bootstrap), true)
  assert.equal(bootstrap.state, 'ready')
  assert.equal(bootstrap.partner, null, '伴侣还没进来时页面必须自己判空，不能渲染双人组件')
  assert.equal(bootstrap.space.name, '我们的空间')
  assert.equal(bootstrap.space.anniversaryDate, '2026-05-20')
  assert.equal(bootstrap.user.displayName, '阿禾')
  assert.equal(bootstrap.user.avatarKey, 'fox')
})

test('冻结的空间进入只读：状态是 frozen，读放行、写被拒', async () => {
  const data = pairedSpace()
  data.CoupleSpaceList[0].status = 'frozen'
  data.HouseRuleList.push({ _id: 'rule-1', _openid: 'a', spaceId: 'space-1', content: '旧家规', date: isoAt() })
  const service = serviceFor(new MemoryStore(data))

  const bootstrap = await service.execute('getBootstrap', {}, 'a')
  assert.equal(bootstrap.state, 'frozen')
  assert.equal(SPACE_STATES.includes(bootstrap.state), true)

  const rules = await service.execute('getHouseRules', {}, 'a')
  assert.equal(rules.items.length, 1, '冻结后仍然可以查看')

  await assert.rejects(
    () => service.execute('createHouseRule', { content: '新家规' }, 'a'),
    error => error.code === 'SPACE_FROZEN',
  )
  await assert.rejects(
    () => service.execute('updateMood', { mood: 'happy' }, 'a'),
    error => error.code === 'SPACE_FROZEN',
  )
  await assert.rejects(
    () => service.execute('createMemoryPost', { content: '一条记录' }, 'a'),
    error => error.code === 'SPACE_FROZEN',
  )
})

test('待删除的空间进入只读：状态是 deleting，写被拒且提示不同的错误码', async () => {
  const data = pairedSpace()
  data.CoupleSpaceList[0].status = 'deleting'
  const service = serviceFor(new MemoryStore(data))

  const bootstrap = await service.execute('getBootstrap', {}, 'a')
  assert.equal(bootstrap.state, 'deleting')

  await assert.rejects(
    () => service.execute('createWish', { title: '一起去看海' }, 'a'),
    error => error.code === 'SPACE_DELETING',
  )
})

test('已经离开空间的账号回到 unpaired，可以重新开始', async () => {
  const data = pairedSpace()
  data.UserList[1] = { ...data.UserList[1], spaceId: '', memberStatus: 'left' }
  const service = serviceFor(new MemoryStore(data))

  // 解除配对之后必须还能回到设置页，否则这个人就永远卡死了。
  const bootstrap = await service.execute('getBootstrap', {}, 'b')
  assert.equal(bootstrap.state, 'unpaired')
  assert.equal(bootstrap.partner, null)
  assert.equal(bootstrap.space, null)

  // 但共享数据一律拿不到。
  await assert.rejects(() => service.execute('getHouseRules', {}, 'b'), error => error.code === 'NO_SPACE')
  await assert.rejects(() => service.execute('getRecords', {}, 'b'), error => error.code === 'NO_SPACE')
})

test('已建号但还没配对的账号读共享数据时得到 NO_SPACE，而不是空列表', async () => {
  const store = new MemoryStore(emptyWorld())
  const service = serviceFor(store)

  await service.execute('updateProfile', { displayName: '新用户', identityNoticeAccepted: true }, 'newcomer')
  await assert.rejects(() => service.execute('getHouseRules', {}, 'newcomer'), error => error.code === 'NO_SPACE')
  await assert.rejects(() => service.execute('getRecords', {}, 'newcomer'), error => error.code === 'NO_SPACE')
  await assert.rejects(() => service.execute('getUsers', {}, 'newcomer'), error => error.code === 'NO_SPACE')
})

test('未配对账号可以注销个人账号，重新进入时仍是未注册状态', async () => {
  const store = new MemoryStore(emptyWorld())
  const service = serviceFor(store)
  await service.execute('updateProfile', { displayName: '阿禾', identityNoticeAccepted: true }, 'newcomer')

  assert.deepEqual(await service.execute('deleteAccount', {}, 'newcomer'), { deleted: true })
  assert.equal(store.data.UserList.length, 0)

  const bootstrap = await service.execute('getBootstrap', {}, 'newcomer')
  assert.equal(bootstrap.state, 'unpaired')
  assert.equal(bootstrap.user.onboardingComplete, false)
  assert.equal(store.data.UserList.length, 0)
})

test('仍在空间里的账号不能绕过空间流程直接注销个人账号', async () => {
  const store = new MemoryStore(pairedSpace())
  const service = serviceFor(store)

  await assert.rejects(
    () => service.execute('deleteAccount', {}, 'a'),
    error => error.code === 'ACCOUNT_HAS_SPACE',
  )
  assert.equal(store.data.UserList.length, 2)
})

test('未登记的陌生账号仍然拿不到任何东西', async () => {
  const service = serviceFor(new MemoryStore(pairedSpace()))

  // 只有首次设置相关的 action 会为新账号建号，业务 action 一律拒绝。
  await assert.rejects(() => service.execute('getHouseRules', {}, 'outsider'), error => error.code === 'UNAUTHORIZED')
  await assert.rejects(() => service.execute('askXiaoBa', { messages: [{ role: 'user', content: '你好' }] }, 'outsider'), error => error.code === 'UNAUTHORIZED')
  await assert.rejects(() => service.execute('completeMission', { id: 'mission-1' }, 'outsider'), error => error.code === 'UNAUTHORIZED')
})

test('服务端与客户端共用同一套昵称与空间名上限', () => {
  const client = require('../miniprogram/utils/space.js')
  const server = require('../cloudfunctions/api/shared.js')

  assert.equal(server.DISPLAY_NAME_MAX, client.DISPLAY_NAME_MAX)
  assert.equal(server.SPACE_NAME_MAX, client.SPACE_NAME_MAX)
  assert.equal(server.DEFAULT_AVATAR_KEY, client.DEFAULT_AVATAR_KEY)
  assert.deepEqual(server.AVATAR_KEYS, client.AVATARS.map(item => item.key))
})

test('updateProfile 只改自己的昵称和头像，并且校验长度', async () => {
  const store = new MemoryStore(pairedSpace())
  const service = serviceFor(store)

  const updated = await service.execute('updateProfile', { displayName: '新的名字', avatarKey: 'panda' }, 'a')
  assert.deepEqual(updated, { displayName: '新的名字', avatarKey: 'panda' })
  assert.equal(store.data.UserList[0].displayName, '新的名字')
  assert.equal(store.data.UserList[1].displayName, '小柚', '不能改到伴侣')

  const bootstrap = await service.execute('getBootstrap', {}, 'a')
  assert.equal(bootstrap.user.profileComplete, true, '保存有效昵称后资料状态应由服务端明确标记完成')

  await assert.rejects(
    () => service.execute('updateProfile', { displayName: '一'.repeat(13) }, 'a'),
    error => error.code === 'INVALID_DISPLAY_NAME',
  )
  await assert.rejects(
    () => service.execute('updateProfile', { displayName: '阿禾', avatarKey: 'unknown' }, 'a'),
    error => error.code === 'INVALID_AVATAR',
  )
})
