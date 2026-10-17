const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const modulePath = path.join(__dirname, '../miniprogram/utils/review-demo.js')

test('review demo provides cloned local data for every business read route', () => {
  assert.equal(fs.existsSync(modulePath), true, 'review demo module is missing')
  const { createReviewDemo } = require(modulePath)
  const demo = createReviewDemo()

  const users = demo.handle('getUsers')
  assert.deepEqual(users.map(user => user._openid), ['review-self', 'review-partner'])
  assert.equal(users[0].canEditMood, true)
  users[0].credit = 0
  assert.equal(demo.handle('getUsers')[0].credit, 88)

  assert.equal(demo.handle('getSession')._openid, 'review-self')
  assert.ok(demo.handle('getHouseRules').items.length)
  assert.ok(demo.handle('getDinnerData').dishes.length)
  assert.ok(demo.handle('getRecords').posts.length)
  assert.ok(demo.handle('getRecords').wishes.length)
  assert.equal(demo.handle('getSchedule').items.length, 0)
  assert.ok(demo.handle('getList', { list: 'MissionList' }).length)
  assert.ok(demo.handle('getList', { list: 'MarketList' }).length)
  assert.ok(demo.handle('getStorage').length)

  const mission = demo.handle('getList', { list: 'MissionList' })[0]
  assert.deepEqual(demo.handle('getById', { list: 'MissionList', id: mission._id }), mission)
})

test('review demo exposes the same bootstrap shape the cloud sends', () => {
  const { createReviewDemo } = require(modulePath)
  const { isBootstrap } = require('../miniprogram/utils/space.js')
  const demo = createReviewDemo()
  const bootstrap = demo.handle('getBootstrap')

  assert.equal(isBootstrap(bootstrap), true)
  assert.equal(bootstrap.state, 'ready')
  assert.equal(bootstrap.user.openid, 'review-self')
  assert.equal(bootstrap.partner.openid, 'review-partner')
  assert.equal(bootstrap.features.schedule, false)

  const identity = demo.identity
  assert.equal(identity.currentUser.openid, 'review-self')
  assert.equal(identity.partner.openid, 'review-partner')
  assert.equal(identity.spaceState, 'ready')
})

test('review demo never borrows a real identity or personal date', () => {
  const { createReviewDemo } = require(modulePath)
  const text = JSON.stringify(createReviewDemo())
  for (const secret of ['PRIVATE_MARKER_42', 'images/memories']) {
    assert.equal(text.includes(secret), false, `预览示例数据里出现了私人内容：${secret}`)
  }
})

test('review demo rejects every mutation and private capability with one readable error', () => {
  assert.equal(fs.existsSync(modulePath), true, 'review demo module is missing')
  const { createReviewDemo } = require(modulePath)
  const demo = createReviewDemo()
  const blocked = [
    'registerPartnerReminder', 'updateMood', 'syncWeRun', 'askXiaoBa',
    'createMemoryPost', 'toggleMemoryLike', 'addMemoryComment', 'deleteMemoryPost',
    'createWish', 'toggleWish', 'deleteWish', 'createHouseRule', 'deleteHouseRule',
    'createDish', 'toggleDish', 'deleteDish', 'completeDinnerOrder',
    'createElement', 'setStar', 'deleteElement', 'useStorage', 'completeMission', 'buyItem',
  ]

  for (const action of blocked) {
    assert.throws(
      () => demo.handle(action, {}),
      error => error.code === 'REVIEW_READ_ONLY' && /只读/.test(error.message),
      action,
    )
  }
})
