// M4：额度与滥用控制。
// 覆盖计划 §6.4 的五件事：每日小八上限、图片归属、频率限制、成本开关、监控匿名。
const test = require('node:test')
const assert = require('node:assert/strict')

const { MemoryStore, emptyWorld, pairedSpace } = require('./helpers/memory-store.cjs')
const shared = require('../cloudfunctions/api/shared.js')
const client = require('../miniprogram/utils/space.js')
const { createService } = require('../cloudfunctions/api/service.js')

const BUCKET = 'cloud://test.bucket'
const ASK = { aiConsent: true, messages: [{ role: 'user', content: '在吗' }] }

// 空间 1 是 pairedSpace 里的阿禾与小柚；这里再补一个互不相干的空间 2。
function twoSpaces() {
  const data = pairedSpace()
  data.CoupleSpaceList.push({
    _id: 'space-2', name: '另一个空间', anniversaryDate: '', status: 'active', featureFlags: {}, createdBy: 'c',
  })
  data.UserList.push(
    { _id: 'user-c', _openid: 'c', credit: 5, spaceId: 'space-2', memberStatus: 'active', displayName: '阿木' },
    { _id: 'user-d', _openid: 'd', credit: 5, spaceId: 'space-2', memberStatus: 'active', displayName: '小满' },
  )
  data.MemoryPostList.push({ _id: 'post-space-2', _openid: 'c', spaceId: 'space-2', content: '别处的记录', likedBy: [], comments: [] })
  return data
}

// 可控时钟。service 里的频率窗口和「今天」都靠它推进，不用真的等。
function clockAt(date) {
  let current = new Date(date)
  return {
    now: () => new Date(current),
    advance: ms => { current = new Date(current.getTime() + ms) },
    jumpTo: next => { current = new Date(next) },
  }
}

function build(data, options = {}) {
  const clock = options.clock || clockAt(options.at || new Date(2026, 8, 16, 9, 0, 0))
  const store = new MemoryStore(data)
  const service = createService(store, clock.now, options.askAI || (async () => '嗯，我在。'), options.service || {})
  return { store, service, clock }
}

test('小八每天每空间 40 次：第 41 次被拒，被拒不计数，次日恢复', async () => {
  const { store, service, clock } = build(pairedSpace())
  const ask = () => service.execute('askXiaoBa', ASK, 'a')

  for (let index = 0; index < shared.AI_DAILY_LIMIT; index += 1) {
    await ask()
    clock.advance(2 * 60 * 1000) // 跨过 60 秒的频率窗口，只测每日额度
  }
  assert.equal(store.data.CoupleSpaceList[0].aiUsage.count, shared.AI_DAILY_LIMIT)

  await assert.rejects(ask(), error => error.code === 'AI_QUOTA_EXCEEDED')
  assert.equal(store.data.CoupleSpaceList[0].aiUsage.count, shared.AI_DAILY_LIMIT, '被拒的请求不该把计数继续推高')

  clock.jumpTo(new Date(2026, 8, 17, 9, 0, 0))
  await ask()
  assert.deepEqual(store.data.CoupleSpaceList[0].aiUsage, { date: '2026-09-17', count: 1 })
})

test('小八额度按空间各自计数，一个空间用完不影响另一个', async () => {
  const data = twoSpaces()
  data.CoupleSpaceList[0].aiUsage = { date: '2026-09-16', count: shared.AI_DAILY_LIMIT }
  const { store, service } = build(data)

  await assert.rejects(service.execute('askXiaoBa', ASK, 'a'), error => error.code === 'AI_QUOTA_EXCEEDED')
  await service.execute('askXiaoBa', ASK, 'c')
  assert.deepEqual(store.data.CoupleSpaceList[1].aiUsage, { date: '2026-09-16', count: 1 })
})

test('小八每分钟最多 10 次，被限流时不消耗当日额度', async () => {
  const { store, service, clock } = build(pairedSpace())
  const ask = () => service.execute('askXiaoBa', ASK, 'a')

  for (let index = 0; index < shared.RATE_LIMITS.askXiaoBa.max; index += 1) await ask()
  await assert.rejects(ask(), error => error.code === 'TOO_MANY_REQUESTS')
  assert.equal(store.data.CoupleSpaceList[0].aiUsage.count, shared.RATE_LIMITS.askXiaoBa.max)

  clock.advance(61 * 1000)
  await ask()
  assert.equal(store.data.CoupleSpaceList[0].aiUsage.count, shared.RATE_LIMITS.askXiaoBa.max + 1)
})

test('邀请重新生成的频率窗口过去之后恢复', async () => {
  const data = pairedSpace()
  data.UserList[1] = { ...data.UserList[1], spaceId: '', memberStatus: 'left' }
  const { service, clock } = build(data)
  const regenerate = () => service.execute('regenerateInvite', {}, 'a')

  for (let index = 0; index < shared.RATE_LIMITS.regenerateInvite.max; index += 1) await regenerate()
  await assert.rejects(regenerate(), error => error.code === 'TOO_MANY_REQUESTS')

  clock.advance(shared.RATE_LIMITS.regenerateInvite.windowMs + 1000)
  const fresh = await regenerate()
  assert.equal(typeof fresh.inviteToken, 'string')
})

test('反复创建空间会被限流：前 5 次放行，第 6 次拒绝', async () => {
  const { service } = build(emptyWorld())
  await service.execute('updateProfile', { displayName: '新用户', identityNoticeAccepted: true }, 'newcomer')
  const attempt = () => service.execute('createSpace', { name: '我们的空间' }, 'newcomer')

  for (let index = 0; index < shared.RATE_LIMITS.createSpace.max; index += 1) {
    try {
      await attempt()
    } catch (error) {
      assert.notEqual(error.code, 'TOO_MANY_REQUESTS', '前 5 次不该被限流')
    }
  }
  await assert.rejects(attempt(), error => error.code === 'TOO_MANY_REQUESTS')
})

test('频率计数按账号各自存放，一个人被限流不拖累另一个人', async () => {
  const { store, service } = build(pairedSpace())
  const post = await service.execute('createMemoryPost', { content: '一条普通记录' }, 'a')
  const like = who => service.execute('toggleMemoryLike', { id: post._id }, who)

  for (let index = 0; index < shared.RATE_LIMITS.toggleMemoryLike.max; index += 1) await like('a')
  await assert.rejects(like('a'), error => error.code === 'TOO_MANY_REQUESTS')
  await like('b')

  const alice = store.data.UserList.find(user => user._openid === 'a')
  const bob = store.data.UserList.find(user => user._openid === 'b')
  assert.equal(alice.rateLimits.toggleMemoryLike.count, shared.RATE_LIMITS.toggleMemoryLike.max)
  assert.equal(bob.rateLimits.toggleMemoryLike.count, 1)
})

test('并发评论不能绕过每分钟二十次限制', async () => {
  const { store, service } = build(pairedSpace())
  const post = await service.execute('createMemoryPost', { content: '并发测试' }, 'a')

  const results = await Promise.allSettled(Array.from({ length: 25 }, (_, index) => (
    service.execute('addMemoryComment', { id: post._id, content: `评论${index}` }, 'a')
  )))

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 20)
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'TOO_MANY_REQUESTS').length, 5)
  assert.equal(store.data.MemoryPostList[0].comments.length, 20)
  assert.equal(store.data.UserList.find(user => user._openid === 'a').rateLimits.addMemoryComment.count, 20)
})

test('猜别人空间的记录编号先撞上 NOT_FOUND，不消耗自己的频率额度', async () => {
  const { store, service } = build(twoSpaces())

  await assert.rejects(
    () => service.execute('toggleMemoryLike', { id: 'post-space-2' }, 'a'),
    error => error.code === 'NOT_FOUND',
  )
  await assert.rejects(
    () => service.execute('addMemoryComment', { id: 'post-space-2', content: '这是谁家' }, 'a'),
    error => error.code === 'NOT_FOUND',
  )
  const alice = store.data.UserList.find(user => user._openid === 'a')
  assert.equal(alice.rateLimits, undefined, '被拒的请求不该写频率计数')
})

test('带图记录只接受本空间目录下的图片', async () => {
  const { service } = build(pairedSpace())
  const create = imageFileId => service.execute('createMemoryPost', { content: '记一条', imageFileId }, 'a')

  const mine = await create(`${BUCKET}/couples/space-1/records/a.jpg`)
  assert.equal(mine.imageFileId, `${BUCKET}/couples/space-1/records/a.jpg`)

  await assert.rejects(create(`${BUCKET}/couples/space-2/records/a.jpg`), error => error.code === 'INVALID_IMAGE_SPACE')
  await assert.rejects(create(`${BUCKET}/couples/space-1/../space-2/records/a.jpg`), error => error.code === 'INVALID_IMAGE_SPACE')
  await assert.rejects(create(`${BUCKET}/couples/space-1//records/a.jpg`), error => error.code === 'INVALID_IMAGE_SPACE')
  await assert.rejects(create(`${BUCKET}/other/records/a.jpg`), error => error.code === 'INVALID_IMAGE_SPACE')
  await assert.rejects(create('https://example.com/a.jpg'), error => error.code === 'INVALID_IMAGE')

  const plain = await create('')
  assert.equal(plain.imageFileId, '', '纯文字记录照常保存')
})

test('菜品图片同样受空间目录限制', async () => {
  const { service } = build(pairedSpace())
  const create = imageFileId => service.execute('createDish', {
    title: '番茄牛腩', desc: '', category: 'meat', minutes: 40, imageFileId,
  }, 'a')

  const mine = await create(`${BUCKET}/couples/space-1/dishes/beef.jpg`)
  assert.equal(mine.imageFileId, `${BUCKET}/couples/space-1/dishes/beef.jpg`)
  await assert.rejects(create(`${BUCKET}/couples/space-2/dishes/beef.jpg`), error => error.code === 'INVALID_IMAGE_SPACE')
})

test('迁移前账号仍可用正式旧版上传记录图片，并把旧路径锁定到当前空间', async () => {
  const deleted = []
  const { store, service } = build(pairedSpace(), {
    service: { deleteFiles: async fileIds => deleted.push(...fileIds) },
  })
  const fileId = `${BUCKET}/records/1726812345678-abc1234.jpg`

  const post = await service.execute('createMemoryPost', { content: '旧正式版记录', imageFileId: fileId }, 'a')

  assert.equal(post.imageFileId, fileId)
  assert.deepEqual(
    store.data.SpaceFileList.map(row => ({ spaceId: row.spaceId, fileId: row.fileId, legacyTrusted: row.legacyTrusted })),
    [{ spaceId: 'space-1', fileId, legacyTrusted: true }],
  )

  await service.execute('deleteMemoryPost', { id: post._id }, 'a')
  assert.deepEqual(deleted, [fileId], '兼容上传的旧路径图片也必须能正常删除')
})

test('迁移前账号仍可用正式旧版上传菜品图片', async () => {
  const { store, service } = build(pairedSpace())
  const fileId = `${BUCKET}/dishes/1726812345678-def5678.jpg`

  const dish = await service.execute('createDish', {
    title: '旧版菜品', desc: '', category: 'meat', minutes: 20, imageFileId: fileId,
  }, 'a')

  assert.equal(dish.imageFileId, fileId)
  assert.equal(store.data.SpaceFileList[0].legacyTrusted, true)
  assert.equal(store.data.SpaceFileList[0].spaceId, 'space-1')
})

test('新账号和已归属其他空间的旧图片不能走正式旧版兼容通道', async () => {
  const legacyFile = `${BUCKET}/records/1726812345678-abc1234.jpg`
  const fresh = pairedSpace()
  fresh.UserList.forEach(user => { user.createdAt = '2026-09-20T00:00:00.000Z' })
  const freshService = build(fresh).service

  await assert.rejects(
    () => freshService.execute('createMemoryPost', { content: '新账号', imageFileId: legacyFile }, 'a'),
    error => error.code === 'INVALID_IMAGE_SPACE',
  )

  const claimed = pairedSpace()
  claimed.SpaceFileList = [{ _id: 'owned-by-space-2', spaceId: 'space-2', fileId: legacyFile, legacyTrusted: true }]
  const claimedService = build(claimed).service
  await assert.rejects(
    () => claimedService.execute('createMemoryPost', { content: '不能借图', imageFileId: legacyFile }, 'a'),
    error => error.code === 'INVALID_IMAGE_SPACE',
  )
})

test('HUBA_PAUSE 解析：默认全开，按名字停用', () => {
  assert.deepEqual(shared.costGuardFrom(undefined), { ai: true, image: true })
  assert.deepEqual(shared.costGuardFrom({}), { ai: true, image: true })
  assert.deepEqual(shared.costGuardFrom({ HUBA_PAUSE: '' }), { ai: true, image: true })
  assert.deepEqual(shared.costGuardFrom({ HUBA_PAUSE: 'ai' }), { ai: false, image: true })
  assert.deepEqual(shared.costGuardFrom({ HUBA_PAUSE: ' AI , Image ' }), { ai: false, image: false })
})

test('成本告警时只停 AI 与带图，文字功能不受影响', async () => {
  const { store, service } = build(pairedSpace(), {
    askAI: async () => '嗯，我在。',
    service: { costGuard: { ai: false, image: false } },
  })

  await assert.rejects(service.execute('askXiaoBa', ASK, 'a'), error => error.code === 'AI_PAUSED')
  assert.equal(store.data.CoupleSpaceList[0].aiUsage, undefined, '停用的 AI 不该消耗额度')

  const picture = `${BUCKET}/couples/space-1/records/a.jpg`
  await assert.rejects(
    () => service.execute('createMemoryPost', { content: '带图', imageFileId: picture }, 'a'),
    error => error.code === 'IMAGE_PAUSED',
  )
  await assert.rejects(
    () => service.execute('createDish', { title: '番茄牛腩', desc: '', category: 'meat', minutes: 40, imageFileId: picture }, 'a'),
    error => error.code === 'IMAGE_PAUSED',
  )

  const plain = await service.execute('createMemoryPost', { content: '只有文字' }, 'a')
  assert.ok(plain._id)
  const wish = await service.execute('createWish', { title: '一起去看海' }, 'a')
  assert.ok(wish._id)
})

test('监控只上报空间匿名编号，不含任何身份信息', () => {
  const ref = shared.anonymousSpaceRef('space-1')
  assert.match(ref, /^[0-9a-f]{8}$/)
  assert.equal(ref, shared.anonymousSpaceRef('space-1'), '同一空间编号稳定')
  assert.notEqual(ref, shared.anonymousSpaceRef('space-2'))
  assert.equal(ref.includes('space-1'), false)
  assert.equal(shared.anonymousSpaceRef(''), 'no-space')
  assert.equal(shared.anonymousSpaceRef(undefined), 'no-space')

  const line = shared.monitorPayload({ action: 'askXiaoBa', status: 'error', code: 'AI_PAUSED', ms: 12, spaceId: 'space-1' })
  assert.deepEqual(Object.keys(line), ['scope', 'action', 'status', 'code', 'ms', 'space'])
  assert.equal(line.space, ref)
  assert.equal(JSON.stringify(line).includes('space-1'), false)

  const failure = shared.errorPayload({ action: 'createDish', spaceId: 'space-1', code: 'INVALID_IMAGE', error: new Error('boom') })
  assert.deepEqual(Object.keys(failure), ['scope', 'action', 'space', 'name', 'code', 'stack'])
  assert.equal(failure.space, ref)
  assert.equal(failure.code, 'INVALID_IMAGE')
  assert.equal(JSON.stringify(failure).includes('space-1'), false)
})

test('客户端上传前的图片上限与服务端保持一致', () => {
  assert.equal(client.IMAGE_MAX_BYTES, shared.IMAGE_MAX_BYTES)
  assert.equal(client.validatePickedImage({ size: shared.IMAGE_MAX_BYTES }).ok, true)
  assert.equal(client.validatePickedImage({ size: shared.IMAGE_MAX_BYTES + 1 }).ok, false)
  assert.match(client.validatePickedImage({ size: shared.IMAGE_MAX_BYTES + 1 }).error, /5MB/)
  // 拿不到大小时不拦，交给云端最终判断
  assert.equal(client.validatePickedImage({}).ok, true)
  assert.equal(client.validatePickedImage(null).ok, true)
})

test('上传路径与图片校验前缀约定一致', () => {
  const prefix = shared.spaceImagePrefix('space-1')
  assert.equal(prefix, `${shared.IMAGE_SPACE_PREFIX}space-1/`)
  // 客户端 spaceUploadPath 拼出来的对象路径，加到任一环境前缀后面都必须通过校验
  const objectPath = `${prefix}records/1700000000000-abcdefg.jpg`
  assert.ok(objectPath.startsWith(prefix))
  assert.equal(shared.validateSpaceImage(`${BUCKET}/${objectPath}`, 'space-1'), `${BUCKET}/${objectPath}`)
})
