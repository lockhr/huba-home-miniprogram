const test = require('node:test')
const assert = require('node:assert/strict')

const { MemoryStore, pairedSpace } = require('./helpers/memory-store.cjs')
const { createService } = require('../cloudfunctions/api/service.js')

const BUCKET = 'cloud://env.bucket'

function world() {
  const data = pairedSpace()
  data.SpaceFileList = []
  data.ScheduleList = []
  return data
}

function createAppearanceService(data = world(), options = {}) {
  const deleted = []
  const store = new MemoryStore(data)
  const service = createService(store, () => '2026-10-05T00:00:00.000Z', null, {
    moderateImage: async () => {},
    deleteFiles: async fileIds => { deleted.push(...fileIds) },
    ...options,
  })
  return { store, service, deleted }
}

test('空间双方都能替换共享装饰图，bootstrap 返回同一份装扮', async () => {
  const { store, service } = createAppearanceService()
  const imageFileId = `${BUCKET}/couples/space-1/appearance/hero/a.jpg`

  const result = await service.execute('setSpaceAppearance', { slot: 'hero', imageFileId }, 'b')

  assert.deepEqual(result, { slot: 'hero', imageFileId })
  assert.equal(store.data.CoupleSpaceList[0].appearance.heroImageFileId, imageFileId)
  assert.equal(store.data.SpaceFileList[0].fileId, imageFileId)
  const forA = await service.execute('getBootstrap', {}, 'a')
  const forB = await service.execute('getBootstrap', {}, 'b')
  assert.equal(forA.space.appearance.heroImageFileId, imageFileId)
  assert.deepEqual(forA.space.appearance, forB.space.appearance)
})

test('九个固定页面图片位都允许共享，且必须写入各自专用目录', async () => {
  const slots = ['hero', 'anniversary', 'rules', 'welcome', 'mission', 'market', 'records', 'dinner', 'storage']
  for (const slot of slots) {
    const { store, service } = createAppearanceService()
    const imageFileId = `${BUCKET}/couples/space-1/appearance/${slot}/a.jpg`
    const result = await service.execute('setSpaceAppearance', { slot, imageFileId }, 'a')
    assert.equal(result.imageFileId, imageFileId)
    assert.equal(store.data.CoupleSpaceList[0].appearance[`${slot}ImageFileId`], imageFileId)
  }

  const { service } = createAppearanceService()
  await assert.rejects(
    () => service.execute('setSpaceAppearance', {
      slot: 'mission',
      imageFileId: `${BUCKET}/couples/space-1/appearance/market/a.jpg`,
    }, 'a'),
    error => error.code === 'INVALID_APPEARANCE_IMAGE',
  )
})

test('头像接口只更新调用者本人并下发给双方', async () => {
  const { store, service } = createAppearanceService()
  const imageFileId = `${BUCKET}/couples/space-1/appearance/avatar/a.jpg`

  assert.deepEqual(await service.execute('setMyAvatarImage', { imageFileId }, 'a'), { imageFileId })

  assert.equal(store.data.UserList[0].avatarFileId, imageFileId)
  assert.equal(store.data.UserList[1].avatarFileId || '', '')
  const forB = await service.execute('getBootstrap', {}, 'b')
  assert.equal(forB.partner.avatarFileId, imageFileId)
  assert.equal(forB.user.avatarFileId, '')
})

test('装扮槽位、空间路径与专用目录均由服务端校验', async () => {
  const { service } = createAppearanceService()
  await assert.rejects(
    () => service.execute('setSpaceAppearance', { slot: 'unknown', imageFileId: `${BUCKET}/couples/space-1/appearance/hero/a.jpg` }, 'a'),
    error => error.code === 'INVALID_APPEARANCE_SLOT',
  )
  await assert.rejects(
    () => service.execute('setSpaceAppearance', { slot: 'hero', imageFileId: `${BUCKET}/couples/space-2/appearance/hero/a.jpg` }, 'a'),
    error => error.code === 'INVALID_IMAGE_SPACE',
  )
  await assert.rejects(
    () => service.execute('setSpaceAppearance', { slot: 'hero', imageFileId: `${BUCKET}/couples/space-1/records/a.jpg` }, 'a'),
    error => error.code === 'INVALID_APPEARANCE_IMAGE',
  )
  await assert.rejects(
    () => service.execute('setMyAvatarImage', { imageFileId: `${BUCKET}/couples/space-1/appearance/hero/a.jpg` }, 'a'),
    error => error.code === 'INVALID_APPEARANCE_IMAGE',
  )
})

test('内容安全拒绝或空间只读时不改变旧图片', async () => {
  const data = world()
  data.CoupleSpaceList[0].appearance = { heroImageFileId: `${BUCKET}/couples/space-1/appearance/hero/old.jpg` }
  const unsafe = createAppearanceService(data, {
    moderateImage: async () => { const error = new Error('risky'); error.code = 'CONTENT_REJECTED'; throw error },
  })
  await assert.rejects(
    () => unsafe.service.execute('setSpaceAppearance', { slot: 'hero', imageFileId: `${BUCKET}/couples/space-1/appearance/hero/new.jpg` }, 'a'),
    error => error.code === 'CONTENT_REJECTED',
  )
  assert.match(unsafe.store.data.CoupleSpaceList[0].appearance.heroImageFileId, /old\.jpg$/)

  const frozenData = world()
  frozenData.CoupleSpaceList[0].status = 'frozen'
  const frozen = createAppearanceService(frozenData)
  await assert.rejects(
    () => frozen.service.execute('setMyAvatarImage', { imageFileId: `${BUCKET}/couples/space-1/appearance/avatar/a.jpg` }, 'a'),
    error => error.code === 'SPACE_FROZEN',
  )
})

test('替换后清理无引用旧图，恢复默认清空字段', async () => {
  const data = world()
  const oldFileId = `${BUCKET}/couples/space-1/appearance/hero/old.jpg`
  const newFileId = `${BUCKET}/couples/space-1/appearance/hero/new.jpg`
  data.CoupleSpaceList[0].appearance = { heroImageFileId: oldFileId }
  data.SpaceFileList.push({ _id: 'old-ledger', spaceId: 'space-1', fileId: oldFileId })
  const { store, service, deleted } = createAppearanceService(data)

  await service.execute('setSpaceAppearance', { slot: 'hero', imageFileId: newFileId }, 'a')
  assert.deepEqual(deleted, [oldFileId])
  assert.equal(store.data.SpaceFileList.find(item => item.fileId === oldFileId).retiredAt, '2026-10-05T00:00:00.000Z')
  assert.equal(store.data.SpaceFileList.some(item => item.fileId === newFileId), true)

  await service.execute('setSpaceAppearance', { slot: 'hero', imageFileId: '' }, 'b')
  assert.equal(store.data.CoupleSpaceList[0].appearance.heroImageFileId, '')
  assert.deepEqual(deleted, [oldFileId, newFileId])
})

test('旧图仍被本人头像引用时不能删除云文件', async () => {
  const data = world()
  const shared = `${BUCKET}/couples/space-1/appearance/hero/shared.jpg`
  data.CoupleSpaceList[0].appearance = { heroImageFileId: shared }
  data.UserList[0].avatarFileId = shared
  data.SpaceFileList.push({ _id: 'shared-ledger', spaceId: 'space-1', fileId: shared })
  const { store, service, deleted } = createAppearanceService(data)

  await service.execute('setSpaceAppearance', { slot: 'hero', imageFileId: '' }, 'b')

  assert.deepEqual(deleted, [])
  assert.equal(store.data.SpaceFileList.some(item => item.fileId === shared), true)
})

test('业务图片不能借用装扮目录，删除旧记录也不能删正在展示的头像或装饰图', async () => {
  const data = world()
  const avatarFileId = `${BUCKET}/couples/space-1/appearance/avatar/b.jpg`
  const heroFileId = `${BUCKET}/couples/space-1/appearance/hero/shared.jpg`
  data.UserList[1].avatarFileId = avatarFileId
  data.CoupleSpaceList[0].appearance = { heroImageFileId: heroFileId }
  data.SpaceFileList.push(
    { _id: 'avatar-ledger', spaceId: 'space-1', fileId: avatarFileId },
    { _id: 'hero-ledger', spaceId: 'space-1', fileId: heroFileId },
  )
  data.WishList = [
    { _id: 'wish-avatar', _openid: 'a', spaceId: 'space-1', title: '旧心愿', imageFileId: avatarFileId },
    { _id: 'wish-hero', _openid: 'a', spaceId: 'space-1', title: '旧心愿', imageFileId: heroFileId },
  ]
  const { service, deleted } = createAppearanceService(data)

  await assert.rejects(
    () => service.execute('createWish', { title: '不能借用头像', imageFileId: avatarFileId }, 'a'),
    error => error.code === 'INVALID_IMAGE_SPACE',
  )
  await service.execute('deleteWish', { id: 'wish-avatar' }, 'a')
  await service.execute('deleteWish', { id: 'wish-hero' }, 'a')
  assert.deepEqual(deleted, [])
})

test('离开空间时清除自定义头像，不能把旧空间图片带给新伴侣', async () => {
  const data = world()
  data.UserList[0].avatarFileId = `${BUCKET}/couples/space-1/appearance/avatar/a.jpg`
  const { store, service } = createAppearanceService(data)

  await service.execute('unpair', {}, 'a')

  assert.equal(store.data.UserList[0].avatarFileId, '')
  assert.equal(store.data.UserList[0].spaceId, '')
})

test('已入台账的旧装扮文件不能重新挂回其他装扮位', async () => {
  const data = world()
  const oldFileId = `${BUCKET}/couples/space-1/appearance/hero/old.jpg`
  data.SpaceFileList.push({ _id: 'old-ledger', spaceId: 'space-1', fileId: oldFileId })
  const { service } = createAppearanceService(data)

  await assert.rejects(
    () => service.execute('setSpaceAppearance', { slot: 'hero', imageFileId: oldFileId }, 'a'),
    error => error.code === 'INVALID_APPEARANCE_IMAGE',
  )
})

test('内容审核中的旧图在被并发替换删除后不能重新挂回', async () => {
  const data = world()
  const oldFileId = `${BUCKET}/couples/space-1/appearance/hero/old.jpg`
  const newFileId = `${BUCKET}/couples/space-1/appearance/hero/new.jpg`
  data.CoupleSpaceList[0].appearance = { heroImageFileId: oldFileId }
  data.SpaceFileList.push({ _id: 'old-ledger', spaceId: 'space-1', fileId: oldFileId })
  let releaseOldReview
  let oldReviewStarted
  const oldReviewReady = new Promise(resolve => { oldReviewStarted = resolve })
  const oldReviewBlocked = new Promise(resolve => { releaseOldReview = resolve })
  const { store, service, deleted } = createAppearanceService(data, {
    moderateImage: async fileId => {
      if (fileId !== oldFileId) return
      oldReviewStarted()
      await oldReviewBlocked
    },
  })

  const staleRequest = service.execute('setSpaceAppearance', { slot: 'hero', imageFileId: oldFileId }, 'b')
  await oldReviewReady
  await service.execute('setSpaceAppearance', { slot: 'hero', imageFileId: newFileId }, 'a')
  releaseOldReview()

  await assert.rejects(staleRequest, error => error.code === 'INVALID_APPEARANCE_IMAGE')
  assert.equal(store.data.CoupleSpaceList[0].appearance.heroImageFileId, newFileId)
  assert.deepEqual(deleted, [oldFileId])
  assert.equal(store.data.SpaceFileList.find(item => item.fileId === oldFileId).retiredAt, '2026-10-05T00:00:00.000Z')
})

test('旧业务记录删除装扮目录图片后仍保留不可复用标记', async () => {
  const data = world()
  const oldFileId = `${BUCKET}/couples/space-1/appearance/hero/legacy-wish.jpg`
  data.CoupleSpaceList[0].appearance = { heroImageFileId: oldFileId }
  data.SpaceFileList.push({ _id: 'legacy-ledger', spaceId: 'space-1', fileId: oldFileId })
  data.WishList.push({ _id: 'legacy-wish', _openid: 'a', spaceId: 'space-1', title: '旧心愿', imageFileId: oldFileId })
  let releaseOldReview
  let oldReviewStarted
  const oldReviewReady = new Promise(resolve => { oldReviewStarted = resolve })
  const oldReviewBlocked = new Promise(resolve => { releaseOldReview = resolve })
  const { store, service, deleted } = createAppearanceService(data, {
    moderateImage: async fileId => {
      if (fileId !== oldFileId) return
      oldReviewStarted()
      await oldReviewBlocked
    },
  })

  const staleRequest = service.execute('setSpaceAppearance', { slot: 'hero', imageFileId: oldFileId }, 'b')
  await oldReviewReady
  await service.execute('setSpaceAppearance', { slot: 'hero', imageFileId: '' }, 'a')
  assert.deepEqual(deleted, [])
  await service.execute('deleteWish', { id: 'legacy-wish' }, 'a')
  assert.deepEqual(deleted, [oldFileId])
  releaseOldReview()

  await assert.rejects(staleRequest, error => error.code === 'INVALID_APPEARANCE_IMAGE')
  assert.equal(store.data.CoupleSpaceList[0].appearance.heroImageFileId, '')
  assert.equal(store.data.SpaceFileList.some(item => item.fileId === oldFileId && item.retiredAt), true)
})

test('bootstrap 不向当前伴侣下发其他空间残留的头像或装扮文件 ID', async () => {
  const data = world()
  data.UserList[0].avatarFileId = `${BUCKET}/couples/space-2/appearance/avatar/old.jpg`
  data.CoupleSpaceList[0].appearance = {
    heroImageFileId: `${BUCKET}/couples/space-2/appearance/hero/old.jpg`,
  }
  const { service } = createAppearanceService(data)

  const bootstrap = await service.execute('getBootstrap', {}, 'b')

  assert.equal(bootstrap.partner.avatarFileId, '')
  assert.equal(bootstrap.space.appearance.heroImageFileId, '')
})
