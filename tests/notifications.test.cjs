const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildNotification,
  notificationTimeoutMs,
  sendPartnerNotification,
  sendPartnerNotificationSafely,
} = require('../cloudfunctions/api/notifications.js')

const config = {
  enabled: true,
  templateId: 'template-test',
  page: 'pages/MainPage/index',
  miniprogramState: 'trial',
  fields: {
    event: 'thing1',
    actor: 'name2',
    time: 'time3',
    detail: 'thing4',
  },
}

const SPACE_ID = 'space-1'

function spaceMembers(partnerCredits, partnerGrantVersion = 0) {
  return [
    { _id: 'user-a', _openid: 'openid-a', spaceId: SPACE_ID, memberStatus: 'active', displayName: '阿禾', reminderCredits: 5 },
    { _id: 'user-b', _openid: 'openid-b', spaceId: SPACE_ID, memberStatus: 'active', displayName: '小柚', reminderCredits: partnerCredits, reminderGrantVersion: partnerGrantVersion },
  ]
}

function memoryStore(members, updates = []) {
  const find = id => members.find(user => user._openid === id)
  return {
    async getById(name, id) { return members.find(user => user._id === id) || null },
    async findOne(name, query) {
      assert.equal(name, 'UserList')
      const found = find(query._openid)
      return found ? { ...found } : null
    },
    async findMany(name, query) {
      assert.equal(name, 'UserList')
      return members.filter(user => user.spaceId === query.spaceId).map(user => ({ ...user }))
    },
    async updateById(name, id, patch) {
      updates.push({ name, id, patch })
      Object.assign(members.find(user => user._id === id), patch)
    },
    async runTransaction(callback) { return callback(this) },
  }
}

test('notification summaries cover important shared actions and omit noisy actions', async () => {
  const store = {
    async getById(list, id) {
      assert.equal(list, 'MissionList')
      assert.equal(id, 'mission-1')
      return { title: '带一杯热可可' }
    },
  }

  assert.deepEqual(await buildNotification('createMemoryPost', { content: '今天一起看了晚霞，特别开心。' }, {}, store), {
    event: '写下了新记录',
    detail: '今天一起看了晚霞，特别开心。',
  })
  assert.deepEqual(await buildNotification('completeMission', { id: 'mission-1' }, {}, store), {
    event: '完成了你的任务',
    detail: '带一杯热可可',
  })
  assert.equal(await buildNotification('toggleMemoryLike', {}, {}, store), null)
  assert.equal(await buildNotification('deleteWish', {}, {}, store), null)
  assert.equal(await buildNotification('updateMood', { mood: 'happy' }, {}, store), null)
  assert.equal(await buildNotification('syncWeRun', {}, {}, store), null)
})

test('ignored actions return before querying couple data', async () => {
  const store = {
    async findOne() { throw new Error('ignored action must not query users') },
    async findMany() { throw new Error('ignored action must not query members') },
  }

  assert.deepEqual(await sendPartnerNotification({
    cloud: {},
    store,
    openid: 'new-user',
    action: 'getBootstrap',
    input: {},
    result: {},
    config,
  }), { sent: false, reason: 'IGNORED_ACTION' })
})

test('partner notification sends only to the other member of the caller space', async () => {
  const calls = []
  const cloud = {
    openapi: {
      subscribeMessage: {
        async send(payload) { calls.push(payload); return { errCode: 0 } },
      },
    },
  }
  const updates = []
  const store = memoryStore(spaceMembers(2), updates)
  const result = await sendPartnerNotification({
    cloud,
    store,
    openid: 'openid-a',
    action: 'createWish',
    input: { title: '一起去海边看日出' },
    result: {},
    now: () => new Date('2026-09-11T04:30:00.000Z'),
    config,
  })

  assert.equal(result.sent, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].touser, 'openid-b')
  assert.equal(calls[0].templateId, 'template-test')
  assert.equal(calls[0].page, 'pages/MainPage/index')
  assert.equal(calls[0].miniprogramState, 'trial')
  assert.deepEqual(calls[0].data, {
    thing1: { value: '添加了新的愿望' },
    name2: { value: '阿禾' },
    time3: { value: '2026年9月11日 12:30' },
    thing4: { value: '本条后剩1次提醒，记得补充' },
  })
  assert.equal(updates.length, 1)
  assert.equal(updates[0].name, 'UserList')
  assert.equal(updates[0].id, 'user-b')
  assert.equal(updates[0].patch.reminderReady, true)
  assert.equal(updates[0].patch.reminderCredits, 1)
})

test('partner notification also routes from the second member back to the first', async () => {
  const calls = []
  const updates = []
  const cloud = {
    openapi: {
      subscribeMessage: {
        async send(payload) { calls.push(payload); return { errCode: 0 } },
      },
    },
  }
  const store = memoryStore(spaceMembers(1), updates)

  const result = await sendPartnerNotification({
    cloud,
    store,
    openid: 'openid-b',
    action: 'createMemoryPost',
    input: { content: '今天一起散步。' },
    result: {},
    config,
  })

  assert.equal(result.sent, true)
  assert.equal(calls[0].touser, 'openid-a')
  assert.equal(calls[0].data.name2.value, '小柚')
  assert.equal(updates[0].id, 'user-a')
  assert.equal(updates[0].patch.reminderReady, true)
  assert.equal(updates[0].patch.reminderCredits, 4)
})

test('partner notification stays silent for an unpaired caller', async () => {
  const calls = []
  const cloud = { openapi: { subscribeMessage: { async send(payload) { calls.push(payload); return { errCode: 0 } } } } }
  const members = spaceMembers(1)
  members[0] = { ...members[0], spaceId: '' }
  const store = memoryStore(members)

  assert.deepEqual(await sendPartnerNotification({
    cloud, store, openid: 'openid-a', action: 'createWish', input: { title: '旅行' }, result: {}, config,
  }), { sent: false, reason: 'NO_PARTNER' })
  assert.equal(calls.length, 0)
})

test('partner notification stays silent when the space partner has left', async () => {
  const cloud = { openapi: { subscribeMessage: { async send() { throw new Error('should not send') } } } }
  const members = spaceMembers(1)
  members[1] = { ...members[1], memberStatus: 'left' }
  const store = memoryStore(members)

  assert.deepEqual(await sendPartnerNotification({
    cloud, store, openid: 'openid-a', action: 'createWish', input: { title: '旅行' }, result: {}, config,
  }), { sent: false, reason: 'NO_PARTNER' })
})

test('notification stays silent when it is unconfigured or no couple can be resolved', async () => {
  const cloud = { openapi: { subscribeMessage: { async send() { throw new Error('should not send') } } } }
  const store = memoryStore(spaceMembers(1))

  assert.deepEqual(await sendPartnerNotification({
    cloud, store, openid: 'openid-a', action: 'createWish', input: { title: '旅行' }, result: {}, config: { ...config, enabled: false },
  }), { sent: false, reason: 'NOT_CONFIGURED' })

  assert.deepEqual(await sendPartnerNotification({
    cloud, store: { async getById() { return null } }, openid: 'openid-a', action: 'createWish', input: { title: '旅行' }, result: {}, config,
  }), { sent: false, reason: 'NO_PARTNER' })

  assert.deepEqual(await sendPartnerNotification({
    cloud, store, openid: 'someone-else', action: 'createWish', input: { title: '旅行' }, result: {}, config,
  }), { sent: false, reason: 'NO_PARTNER' })
})

function notificationFixture(count, send) {
  const members = spaceMembers(count)
  let payload
  const store = memoryStore(members)
  const cloud = {
    openapi: {
      subscribeMessage: {
        async send(value) {
          payload = value
          return send ? send(members[1]) : { errCode: 0 }
        },
      },
    },
  }
  return {
    user: () => members[1],
    payload: () => payload,
    run: () => sendPartnerNotification({
      cloud, store, openid: 'openid-a', action: 'createMemoryPost', input: { content: '一篇日记' }, result: {}, config,
    }),
  }
}

test('last message includes zero remaining without a separate notification', async () => {
  const f = notificationFixture(1)
  await f.run()
  assert.equal(f.user().reminderCredits, 0)
  assert.equal(f.payload().data.thing4.value, '本条后剩0次提醒，请回首页补充')
  assert.ok(Array.from(f.payload().data.thing4.value).length <= 20)
})

test('zero credits do not call WeChat or go negative', async () => {
  const f = notificationFixture(0)
  assert.equal((await f.run()).reason, 'NO_CREDITS')
  assert.equal(f.payload(), undefined)
  assert.equal(f.user().reminderCredits, 0)
})

test('network failure returns reserved credit without losing a simultaneous grant', async () => {
  const f = notificationFixture(2, user => {
    user.reminderCredits += 1
    user.reminderGrantVersion += 1
    throw new Error('network unavailable')
  })
  await assert.rejects(f.run)
  assert.equal(f.user().reminderCredits, 3)
})

test('safe partner notification logs a failed delivery without failing the business request', async () => {
  const warnings = []
  const logger = { warn(...args) { warnings.push(args) } }
  const store = memoryStore(spaceMembers(1))
  const cloud = {
    openapi: { subscribeMessage: { async send() { throw Object.assign(new Error('network unavailable'), { code: 'NETWORK_ERROR' }) } } },
  }

  const result = await sendPartnerNotificationSafely({
    cloud,
    store,
    openid: 'openid-a',
    action: 'createMemoryPost',
    input: { content: '一篇日记' },
    result: {},
    config,
  }, logger)

  assert.equal(result, null)
  assert.deepEqual(warnings, [['partner notification skipped', 'NETWORK_ERROR']])
})

test('safe partner notification times out a stuck sender without delaying the business request', { timeout: 250 }, async () => {
  const warnings = []
  const logger = { warn(...args) { warnings.push(args) } }
  const store = memoryStore(spaceMembers(1))
  const cloud = {
    openapi: { subscribeMessage: { send() { return new Promise(() => {}) } } },
  }

  const startedAt = Date.now()
  const result = await sendPartnerNotificationSafely({
    cloud,
    store,
    openid: 'openid-a',
    action: 'createMemoryPost',
    input: { content: '一篇日记' },
    result: {},
    config,
  }, { logger, timeoutMs: 20 })

  assert.equal(result, null)
  assert.ok(Date.now() - startedAt < 150)
  assert.deepEqual(warnings, [['partner notification skipped', 'SEND_TIMEOUT']])
})

test('safe partner notification skips delivery when no wait budget remains', async () => {
  const warnings = []
  const logger = { warn(...args) { warnings.push(args) } }
  let sends = 0
  const cloud = {
    openapi: { subscribeMessage: { async send() { sends++; return { errCode: 0 } } } },
  }

  const result = await sendPartnerNotificationSafely({
    cloud,
    store: { async findOne() { throw new Error('sender should not start') } },
    openid: 'openid-a',
    action: 'createMemoryPost',
    input: { content: '一篇日记' },
    result: {},
    config,
  }, { logger, timeoutMs: 0 })

  assert.equal(result, null)
  assert.equal(sends, 0)
  assert.deepEqual(warnings, [['partner notification skipped', 'SEND_TIMEOUT']])
})

test('notification wait budget reserves API response time', () => {
  assert.equal(notificationTimeoutMs(0), 500)
  assert.equal(notificationTimeoutMs(2300), 100)
  assert.equal(notificationTimeoutMs(2400), 0)
})

test('explicit WeChat no-subscription response reconciles credits but keeps new grants', async () => {
  const f = notificationFixture(4, user => {
    user.reminderCredits += 1
    user.reminderGrantVersion += 1
    return { errcode: 43101 }
  })
  await assert.rejects(f.run)
  assert.equal(f.user().reminderCredits, 1)
})

test('other returned WeChat errors do not consume credits', async () => {
  const f = notificationFixture(3, () => ({ errcode: 47003 }))
  await assert.rejects(f.run)
  assert.equal(f.user().reminderCredits, 3)
})
