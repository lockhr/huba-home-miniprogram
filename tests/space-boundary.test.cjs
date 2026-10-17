// M6：空间边界的系统性验证。
//
// 不用「想起哪个接口测哪个接口」的写法：这里直接从 service.js 源码里抓出所有
// action，逐个用「另一个空间的人」的身份去打，然后检查两件事——
//   1) 返回内容里不能出现 B 空间的任何内容；
//   2) B 空间的数据必须一个字节都没变。
// 以后往 service.js 里加了新 action，只要写在 `action === '...'` 的链上，就会自动被覆盖。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { MemoryStore } = require('./helpers/memory-store.cjs')
const { createService } = require('../cloudfunctions/api/service.js')

const AT = '2026-09-16T04:00:00.000Z'
const SERVICE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'api', 'service.js'), 'utf8')
const ACTIONS = Array.from(new Set(
  Array.from(SERVICE_SOURCE.matchAll(/action === '([A-Za-z]+)'/g)).map(matched => matched[1]),
)).sort()

// B 空间里「只属于它」的内容。任何一个出现在 A 空间的返回里就是泄漏。
const SENTINELS = [
  '乙空间',
  '阿木',
  '小满',
  '乙家的任务',
  '乙家的物品',
  '乙家的券',
  '乙空间的家规',
  '乙空间的菜',
  '乙空间的记录',
  '乙空间的愿望',
  '乙空间的课',
  'couples/space-b/',
]

const B_IDS = {
  mission: 'mission-b',
  item: 'item-b',
  storage: 'storage-b',
  rule: 'rule-b',
  dish: 'dish-b',
  post: 'post-b',
  wish: 'wish-b',
  order: 'order-b',
  schedule: 'schedule-b',
}

function boundaryWorld() {
  return {
    CoupleSpaceList: [
      { _id: 'space-a', name: '甲空间', anniversaryDate: '2024-01-01', status: 'active', featureFlags: {}, createdBy: 'a' },
      { _id: 'space-b', name: '乙空间', anniversaryDate: '2023-02-02', status: 'active', featureFlags: {}, createdBy: 'c' },
    ],
    PairInviteList: [
      { _id: 'invite-b', spaceId: 'space-b', inviterOpenid: 'c', tokenDigest: 'digest-b', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z', usedBy: '', usedAt: null },
    ],
    UserList: [
      { _id: 'user-a', _openid: 'a', credit: 10, spaceId: 'space-a', memberStatus: 'active', displayName: '阿禾' },
      { _id: 'user-b', _openid: 'b', credit: 5, spaceId: 'space-a', memberStatus: 'active', displayName: '小柚' },
      { _id: 'user-c', _openid: 'c', credit: 7, spaceId: 'space-b', memberStatus: 'active', displayName: '阿木' },
      { _id: 'user-d', _openid: 'd', credit: 3, spaceId: 'space-b', memberStatus: 'active', displayName: '小满' },
    ],
    MissionList: [
      { _id: 'mission-b', _openid: 'd', spaceId: 'space-b', credit: 5, available: true, title: '乙家的任务', desc: '', date: AT },
    ],
    MarketList: [
      { _id: 'item-b', _openid: 'd', spaceId: 'space-b', credit: 2, available: true, title: '乙家的物品', desc: '', date: AT },
    ],
    StorageList: [
      { _id: 'storage-b', _openid: 'c', spaceId: 'space-b', available: true, star: false, title: '乙家的券', date: AT },
    ],
    HouseRuleList: [
      { _id: 'rule-b', _openid: 'c', spaceId: 'space-b', content: '乙空间的家规', date: AT },
    ],
    MenuList: [
      { _id: 'dish-b', _openid: 'c', spaceId: 'space-b', title: '乙空间的菜', desc: '', category: 'meat', minutes: 30, selected: false, imageFileId: 'cloud://x.y/couples/space-b/dishes/b.jpg', date: AT },
    ],
    DinnerOrderList: [
      { _id: 'order-b', _openid: 'c', spaceId: 'space-b', date: AT, items: [{ title: '乙空间的菜' }] },
    ],
    MemoryPostList: [
      { _id: 'post-b', _openid: 'd', spaceId: 'space-b', content: '乙空间的记录', likedBy: [], comments: [], imageFileId: 'cloud://x.y/couples/space-b/records/b.jpg', date: AT },
    ],
    WishList: [
      { _id: 'wish-b', _openid: 'd', spaceId: 'space-b', title: '乙空间的愿望', completed: false, date: AT },
    ],
    ScheduleList: [
      { _id: 'schedule-b', _openid: 'c', spaceId: 'space-b', ownerKey: 'c', term: '2026-2027-1', days: { 1: [{ title: '乙空间的课' }] } },
    ],
  }
}

// 每个 action 尽量给一份「能打到 B 空间记录上」的合法载荷。
// 载荷打不中也没关系——打不中会直接报错，而报错本身就是安全的；
// 真正要防的是「打中了、还返回了 B 的数据」。
function payloadFor(action) {
  const ids = B_IDS
  switch (action) {
    case 'getById': return { list: 'MissionList', id: ids.mission }
    case 'deleteElement': return { list: 'MissionList', id: ids.mission }
    case 'setStar': return { list: 'StorageList', id: ids.storage, value: true }
    case 'useStorage': return { id: ids.storage }
    case 'completeMission': return { id: ids.mission }
    case 'buyItem': return { id: ids.item }
    case 'deleteHouseRule': return { id: ids.rule }
    case 'deleteDish': return { id: ids.dish }
    case 'toggleDish': return { id: ids.dish, selected: true }
    case 'deleteMemoryPost': return { id: ids.post }
    case 'toggleMemoryLike': return { id: ids.post }
    case 'addMemoryComment': return { id: ids.post, content: '越界留言' }
    case 'toggleWish': return { id: ids.wish, completed: true }
    case 'deleteWish': return { id: ids.wish }
    case 'completeDinnerOrder': return { orderId: ids.order, dishIds: [ids.dish] }
    case 'getList': return { list: 'MissionList' }
    case 'createElement': return { list: 'MissionList', title: '越界任务', desc: '', credit: 1, spaceId: 'space-b' }
    case 'updateMood': return { mood: 'happy' }
    case 'updateProfile': return { displayName: '冒名', avatarKey: 'cat' }
    case 'updateSpace': return { name: '越界改名', anniversaryDate: '' }
    case 'joinSpace': return { inviteToken: 'x'.repeat(64) }
    case 'getInvite': return { inviteToken: 'x'.repeat(64) }
    case 'registerPartnerReminder': return { grantId: 'probe' }
    case 'askXiaoBa': return { messages: [{ role: 'user', content: '你们家有什么规矩？' }] }
    case 'syncWeRun': return { weRunData: { data: { stepInfoList: [{ timestamp: 1789000000, step: 1234 }] } } }
    default: return {}
  }
}

function snapshotSpaceB(store) {
  const rows = {}
  for (const [name, list] of Object.entries(store.data)) {
    const mine = list.filter(row => row && row.spaceId === 'space-b')
    if (mine.length) rows[name] = JSON.parse(JSON.stringify(mine))
  }
  return rows
}

test('action 列表是从 service.js 里抓出来的，不是手写的', () => {
  assert.ok(ACTIONS.length >= 40, `只抓到 ${ACTIONS.length} 个 action，正则可能失效了`)
  for (const known of ['getBootstrap', 'getRecords', 'getSchedule', 'askXiaoBa', 'buyItem', 'toggleMemoryLike']) {
    assert.ok(ACTIONS.includes(known), `漏了 ${known}`)
  }
})

test('每一个 action 都挡得住另一个空间的人，且不改动对方数据', async () => {
  const offenders = []
  const changed = []
  const resolved = []

  for (const action of ACTIONS) {
    const store = new MemoryStore(boundaryWorld())
    const service = createService(store, () => AT, async () => ({ reply: '好呀', model: 'test' }))
    const beforeB = snapshotSpaceB(store)
    const payload = payloadFor(action)
    const payloadIds = Object.values(payload).filter(value => typeof value === 'string')
    let result = null

    try {
      result = await service.execute(action, payload, 'a')
      resolved.push(action)
    } catch (error) {
      // 任何拒绝都是安全的：既没拿到数据，也没改到东西
      assert.ok(error, `${action} 抛出了非 Error 的东西`)
    }

    if (result !== null) {
      const text = JSON.stringify(result) || ''
      for (const sentinel of SENTINELS) {
        if (text.includes(sentinel)) offenders.push(`${action} 的返回里出现了「${sentinel}」`)
      }
      for (const [label, id] of Object.entries(B_IDS)) {
        if (text.includes(id) && !payloadIds.includes(id)) {
          offenders.push(`${action} 的返回里泄漏了 B 空间的 ${label} 编号 ${id}`)
        }
      }
    }

    const afterB = snapshotSpaceB(store)
    if (JSON.stringify(afterB) !== JSON.stringify(beforeB)) {
      changed.push(`${action} 改动了 B 空间的数据`)
    }
  }

  assert.deepEqual(offenders, [], offenders.join('\n'))
  assert.deepEqual(changed, [], changed.join('\n'))
  // 至少有相当一部分 action 是「真的跑通了」的，否则上面两条等于没测
  // 满员空间的 regenerateInvite 现在会被明确拒绝，不计入成功动作。
  assert.ok(resolved.length >= 19, `只有 ${resolved.length} 个 action 跑通，覆盖面不足：${resolved.join(',')}`)
})

test('A 空间的人用 B 空间的 spaceId 提交，写出来的记录仍然属于 A', async () => {
  const store = new MemoryStore(boundaryWorld())
  const service = createService(store, () => AT, async () => ({ reply: '好呀', model: 'test' }))

  const written = []
  written.push(await service.execute('createElement', { list: 'MissionList', title: '任务', desc: '', credit: 1, spaceId: 'space-b' }, 'a'))
  written.push(await service.execute('createMemoryPost', { content: '记录', spaceId: 'space-b' }, 'a'))
  written.push(await service.execute('createWish', { title: '愿望', spaceId: 'space-b' }, 'a'))
  written.push(await service.execute('createHouseRule', { content: '家规', spaceId: 'space-b' }, 'a'))
  written.push(await service.execute('createDish', { title: '菜', category: 'meat', minutes: 10, spaceId: 'space-b' }, 'a'))

  for (const row of written) {
    assert.equal(row.spaceId, 'space-a', `${row._id} 不该落进 B 空间`)
  }
  // 所有属于 B 空间的记录都必须还是原本那几条，不能多出任何一条
  const originalBIds = new Set(Object.values(B_IDS))
  for (const name of ['MissionList', 'MemoryPostList', 'WishList', 'HouseRuleList', 'MenuList']) {
    for (const row of store.data[name]) {
      if (row.spaceId !== 'space-b') continue
      assert.ok(originalBIds.has(row._id), `多出一条属于 B 空间的记录：${name}/${row._id}`)
    }
  }
})

test('图片也不能越界：A 空间的人引用不了 B 空间的图片', async () => {
  const store = new MemoryStore(boundaryWorld())
  const service = createService(store, () => AT, async () => ({ reply: '好呀', model: 'test' }))

  await assert.rejects(
    () => service.execute('createMemoryPost', { content: '借用图片', imageFileId: 'cloud://x.y/couples/space-b/records/b.jpg' }, 'a'),
    error => error.code === 'INVALID_IMAGE_SPACE',
  )
  await assert.rejects(
    () => service.execute('createDish', { title: '菜', category: 'meat', minutes: 10, imageFileId: 'cloud://x.y/couples/space-b/dishes/b.jpg' }, 'a'),
    error => error.code === 'INVALID_IMAGE_SPACE',
  )
})

test('小八永远不会拿到另一个空间的任何内容', async () => {
  const store = new MemoryStore(boundaryWorld())
  const contexts = []
  const service = createService(store, () => AT, async (messages, context) => {
    contexts.push(context && context.appContext)
    return { reply: '好呀', model: 'test' }
  })

  await service.execute('askXiaoBa', { aiConsent: true, messages: [{ role: 'user', content: '我们空间有什么？' }] }, 'a')
  assert.equal(contexts.length, 1)
  const text = String(contexts[0] || '')
  for (const sentinel of SENTINELS) {
    assert.equal(text.includes(sentinel), false, `小八的上下文里出现了「${sentinel}」`)
  }
  assert.ok(text.includes('space-a') || text.includes('阿禾'), '上下文里应该有自己空间的信息，否则这条测试没有意义')
})
