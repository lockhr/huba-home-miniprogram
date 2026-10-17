const test = require('node:test')
const assert = require('node:assert/strict')

const { MemoryStore } = require('./helpers/memory-store.cjs')
const { createService } = require('../cloudfunctions/api/service.js')

const AT = '2026-09-16T04:00:00.000Z'

// 两个互不相干的空间：space-a（阿禾 / 小柚）与 space-b（阿木 / 小满）。
// 另外放了一条「没有 spaceId 的旧记录」，用来证明未迁移的数据不会漏给别人。
function twoSpaces() {
  return {
    CoupleSpaceList: [
      { _id: 'space-a', name: '甲空间', anniversaryDate: '2025-01-01', status: 'active', featureFlags: {}, createdBy: 'a' },
      { _id: 'space-b', name: '乙空间', anniversaryDate: '', status: 'active', featureFlags: {}, createdBy: 'c' },
    ],
    PairInviteList: [],
    UserList: [
      { _id: 'user-a', _openid: 'a', credit: 10, spaceId: 'space-a', memberStatus: 'active', displayName: '阿禾' },
      { _id: 'user-b', _openid: 'b', credit: 5, spaceId: 'space-a', memberStatus: 'active', displayName: '小柚' },
      { _id: 'user-c', _openid: 'c', credit: 7, spaceId: 'space-b', memberStatus: 'active', displayName: '阿木' },
      { _id: 'user-d', _openid: 'd', credit: 3, spaceId: 'space-b', memberStatus: 'active', displayName: '小满' },
    ],
    MissionList: [
      { _id: 'mission-a', _openid: 'b', spaceId: 'space-a', credit: 5, available: true, title: '甲的任务', date: AT },
      { _id: 'mission-b', _openid: 'd', spaceId: 'space-b', credit: 5, available: true, title: '乙的任务', date: AT },
    ],
    MarketList: [
      { _id: 'item-a', _openid: 'b', spaceId: 'space-a', credit: 2, available: true, title: '甲的物品', date: AT },
      { _id: 'item-b', _openid: 'd', spaceId: 'space-b', credit: 2, available: true, title: '乙的物品', date: AT },
    ],
    StorageList: [
      { _id: 'storage-a', _openid: 'a', spaceId: 'space-a', available: true, star: false, title: '甲的券', date: AT },
      { _id: 'storage-b', _openid: 'c', spaceId: 'space-b', available: true, star: false, title: '乙的券', date: AT },
    ],
    HouseRuleList: [
      { _id: 'rule-a', _openid: 'a', spaceId: 'space-a', content: '甲空间的家规', date: AT },
      { _id: 'rule-b', _openid: 'c', spaceId: 'space-b', content: '乙空间的家规', date: AT },
      { _id: 'rule-no-space', _openid: 'a', content: '还没迁移的旧家规', date: AT },
    ],
    MenuList: [
      { _id: 'dish-a', _openid: 'a', spaceId: 'space-a', title: '甲空间的菜', desc: '', category: 'meat', minutes: 30, selected: false, date: AT },
      { _id: 'dish-b', _openid: 'c', spaceId: 'space-b', title: '乙空间的菜', desc: '', category: 'meat', minutes: 30, selected: false, date: AT },
    ],
    DinnerOrderList: [
      { _id: 'order-a', _openid: 'a', spaceId: 'space-a', date: AT, items: [{ title: '甲空间的菜' }] },
      { _id: 'order-b', _openid: 'c', spaceId: 'space-b', date: AT, items: [{ title: '乙空间的菜' }] },
    ],
    MemoryPostList: [
      { _id: 'post-a', _openid: 'b', spaceId: 'space-a', content: '甲空间的记录', likedBy: [], comments: [], date: AT },
      { _id: 'post-b', _openid: 'd', spaceId: 'space-b', content: '乙空间的记录', likedBy: [], comments: [], date: AT },
    ],
    WishList: [
      { _id: 'wish-a', _openid: 'b', spaceId: 'space-a', title: '甲空间的愿望', completed: false, date: AT },
      { _id: 'wish-b', _openid: 'd', spaceId: 'space-b', title: '乙空间的愿望', completed: false, date: AT },
    ],
    ScheduleList: [
      { _id: 'schedule-a', _openid: 'a', spaceId: 'space-a', ownerKey: 'a', term: '2026-2027-1', days: { 1: [{ title: '甲空间的课', time: '08:00–09:35', period: '第1大节', weeks: '1–16周', place: 'A101', teacher: '老师' }] } },
      { _id: 'schedule-b', _openid: 'c', spaceId: 'space-b', ownerKey: 'c', term: '2026-2027-1', days: { 1: [{ title: '乙空间的课', time: '08:00–09:35', period: '第1大节', weeks: '1–16周', place: 'B202', teacher: '老师' }] } },
      { _id: 'schedule-no-space', _openid: 'a', ownerKey: 'a', term: '2026-2027-1', days: { 1: [{ title: '还没迁移的旧课', time: '08:00–09:35', period: '第1大节', weeks: '1–16周', place: 'C303', teacher: '老师' }] } },
    ],
  }
}

function serviceFor(store, options = {}) {
  return createService(store, () => AT, async () => ({ reply: '', model: 'test' }), options)
}

test('列出类接口只返回自己空间里的记录', async () => {
  const service = serviceFor(new MemoryStore(twoSpaces()))

  const rules = await service.execute('getHouseRules', {}, 'a')
  assert.deepEqual(rules.items.map(item => item._id), ['rule-a'])

  const records = await service.execute('getRecords', {}, 'a')
  assert.deepEqual(records.posts.map(item => item._id), ['post-a'])
  assert.deepEqual(records.wishes.map(item => item._id), ['wish-a'])

  const dinner = await service.execute('getDinnerData', {}, 'a')
  assert.deepEqual(dinner.dishes.map(item => item._id), ['dish-a'])
  assert.deepEqual(dinner.orders.map(item => item._id), ['order-a'])

  const missions = await service.execute('getList', { list: 'MissionList' }, 'a')
  assert.deepEqual(missions.map(item => item._id), ['mission-a'])

  const market = await service.execute('getList', { list: 'MarketList' }, 'a')
  assert.deepEqual(market.map(item => item._id), ['item-a'])

  const storage = await service.execute('getStorage', {}, 'a')
  assert.deepEqual(storage.map(item => item._id), ['storage-a'])
})

test('没有 spaceId 的旧记录对任何人都不可见', async () => {
  const service = serviceFor(new MemoryStore(twoSpaces()))

  const rules = await service.execute('getHouseRules', {}, 'a')
  assert.equal(rules.items.some(item => item._id === 'rule-no-space'), false)
  assert.equal(rules.items.some(item => item.content === '还没迁移的旧家规'), false)
})

test('猜别人的记录编号只会得到「记录不存在」', async () => {
  const service = serviceFor(new MemoryStore(twoSpaces()))

  await assert.rejects(() => service.execute('getById', { list: 'MissionList', id: 'mission-b' }, 'a'), error => error.code === 'NOT_FOUND')
  await assert.rejects(() => service.execute('deleteElement', { list: 'MissionList', id: 'mission-b' }, 'a'), error => error.code === 'NOT_FOUND')
  await assert.rejects(() => service.execute('setStar', { list: 'StorageList', id: 'storage-b', value: true }, 'a'), error => error.code === 'NOT_FOUND')
  await assert.rejects(() => service.execute('useStorage', { id: 'storage-b' }, 'a'), error => error.code === 'NOT_FOUND')
  await assert.rejects(() => service.execute('deleteHouseRule', { id: 'rule-b' }, 'a'), error => error.code === 'NOT_FOUND')
  await assert.rejects(() => service.execute('deleteDish', { id: 'dish-b' }, 'a'), error => error.code === 'NOT_FOUND')
  await assert.rejects(() => service.execute('toggleDish', { id: 'dish-b', selected: true }, 'a'), error => error.code === 'NOT_FOUND')
  await assert.rejects(() => service.execute('deleteMemoryPost', { id: 'post-b' }, 'a'), error => error.code === 'NOT_FOUND')
  await assert.rejects(() => service.execute('toggleMemoryLike', { id: 'post-b' }, 'a'), error => error.code === 'NOT_FOUND')
  await assert.rejects(() => service.execute('addMemoryComment', { id: 'post-b', content: '偷偷留言' }, 'a'), error => error.code === 'NOT_FOUND')
  await assert.rejects(() => service.execute('toggleWish', { id: 'wish-b', completed: true }, 'a'), error => error.code === 'NOT_FOUND')
  await assert.rejects(() => service.execute('deleteWish', { id: 'wish-b' }, 'a'), error => error.code === 'NOT_FOUND')
  await assert.rejects(() => service.execute('completeMission', { id: 'mission-b' }, 'a'), error => error.code === 'NOT_FOUND')
  await assert.rejects(() => service.execute('buyItem', { id: 'item-b' }, 'a'), error => error.code === 'NOT_FOUND')
})

test('跨空间偷数据的尝试不会留下任何副作用', async () => {
  const store = new MemoryStore(twoSpaces())
  const service = serviceFor(store)
  const before = JSON.parse(JSON.stringify(store.data))

  const attempts = [
    () => service.execute('deleteElement', { list: 'MissionList', id: 'mission-b' }, 'a'),
    () => service.execute('useStorage', { id: 'storage-b' }, 'a'),
    () => service.execute('deleteHouseRule', { id: 'rule-b' }, 'a'),
    () => service.execute('deleteMemoryPost', { id: 'post-b' }, 'a'),
    () => service.execute('toggleWish', { id: 'wish-b', completed: true }, 'a'),
    () => service.execute('completeMission', { id: 'mission-b' }, 'a'),
    () => service.execute('buyItem', { id: 'item-b' }, 'a'),
  ]
  for (const attempt of attempts) await assert.rejects(attempt)

  assert.deepEqual(store.data, before, '被拒绝的请求不能改动任何数据')
})

test('同一个空间里别人的记录给 FORBIDDEN，跨空间只给 NOT_FOUND', async () => {
  const service = serviceFor(new MemoryStore(twoSpaces()))

  // 同一个空间：确实存在，但只能操作自己的 → 明确告诉调用者越权了
  await assert.rejects(() => service.execute('useStorage', { id: 'storage-a' }, 'b'), error => error.code === 'FORBIDDEN')
  // 另一个空间：连「存不存在」都不能确认
  await assert.rejects(() => service.execute('useStorage', { id: 'storage-b' }, 'b'), error => error.code === 'NOT_FOUND')
})

test('getUsers 只返回同一个空间的两名成员', async () => {
  const service = serviceFor(new MemoryStore(twoSpaces()))

  const mine = await service.execute('getUsers', {}, 'a')
  assert.deepEqual(mine.map(user => user.openid).sort(), ['a', 'b'])
  assert.equal(mine.some(user => user.openid === 'c' || user.openid === 'd'), false)

  const theirs = await service.execute('getUsers', {}, 'c')
  assert.deepEqual(theirs.map(user => user.openid).sort(), ['c', 'd'])
})

test('客户端传来的 spaceId 会被忽略', async () => {
  const store = new MemoryStore(twoSpaces())
  const service = serviceFor(store)

  const created = await service.execute('createElement', {
    list: 'MissionList',
    title: '想投毒的任务',
    desc: '',
    credit: 5,
    spaceId: 'space-b',
  }, 'a')

  assert.equal(created.spaceId, 'space-a', '服务端只认调用者自己的空间')
  assert.equal(store.data.MissionList.find(item => item._id === created._id).spaceId, 'space-a')
  assert.equal(store.data.MissionList.some(item => item._id === created._id && item.spaceId === 'space-b'), false)
})

test('写入的记录一定带上服务端判定的 spaceId', async () => {
  const store = new MemoryStore(twoSpaces())
  const service = serviceFor(store)

  await service.execute('createWish', { title: '新愿望' }, 'a')
  await service.execute('createHouseRule', { content: '新家规' }, 'a')
  await service.execute('createMemoryPost', { content: '新记录' }, 'a')
  await service.execute('createDish', { title: '新菜', category: 'meat', minutes: 10 }, 'a')

  assert.equal(store.data.WishList.at(-1).spaceId, 'space-a')
  assert.equal(store.data.HouseRuleList.at(-1).spaceId, 'space-a')
  assert.equal(store.data.MemoryPostList.at(-1).spaceId, 'space-a')
  assert.equal(store.data.MenuList.at(-1).spaceId, 'space-a')
})

test('买到的物品落进买家自己的空间仓库', async () => {
  const store = new MemoryStore(twoSpaces())
  const service = serviceFor(store)

  // item-a 是小柚上架的，所以由阿禾来兑换
  await service.execute('buyItem', { id: 'item-a' }, 'a')
  const stored = store.data.StorageList.find(item => item.sourceItemId === 'item-a')
  assert.equal(stored.spaceId, 'space-a')
  assert.equal(stored._openid, 'a')
})

test('确认任务只给同空间的任务创建者加积分', async () => {
  const store = new MemoryStore(twoSpaces())
  const service = serviceFor(store)

  await service.execute('completeMission', { id: 'mission-a' }, 'a')
  const owner = store.data.UserList.find(user => user._openid === 'b')
  const other = store.data.UserList.find(user => user._openid === 'd')
  assert.equal(owner.credit, 10)
  assert.equal(other.credit, 3, '另一个空间的人不能因为别人完成任务而加分')
})

test('部署开启课表后，任意空间都只能读取本空间课程', async () => {
  const data = twoSpaces()
  const service = serviceFor(new MemoryStore(data), { capabilities: { schedule: true, xiaoba: true } })

  const mine = await service.execute('getSchedule', {}, 'a')
  assert.deepEqual(mine.items.map(item => item._id), ['schedule-a'])
  assert.equal(mine.items[0].openid, 'a')
  assert.equal(mine.items[0].days['1'][0].title, '甲空间的课')
  assert.equal(
    mine.items.some(item => item._id === 'schedule-no-space'),
    false,
    '没有 spaceId 的旧课表不能漏给别人',
  )

  const other = await service.execute('getSchedule', {}, 'c')
  assert.deepEqual(other.items.map(item => item._id), ['schedule-b'])
})

test('小八的上下文里只有自己空间的数据', async () => {
  const store = new MemoryStore(twoSpaces())
  const contexts = []
  const service = createService(store, () => AT, async (messages, context) => {
    contexts.push(context.appContext)
    return { reply: '', model: 'test' }
  })

  await service.execute('askXiaoBa', { aiConsent: true, messages: [{ role: 'user', content: '我们有什么家规？' }] }, 'a')

  assert.match(contexts[0], /甲空间的家规/)
  assert.doesNotMatch(contexts[0], /乙空间/)
  assert.doesNotMatch(contexts[0], /阿木|小满/)
  assert.doesNotMatch(contexts[0], /还没迁移的旧家规/)
})
