const { test } = require('node:test')
const assert = require('node:assert/strict')
const { MemoryStore, pairedSpace } = require('./helpers/memory-store.cjs')
const { createService } = require('../cloudfunctions/api/service.js')

class CloudBaseTransactionStore extends MemoryStore {
  async runTransaction(callback) {
    return super.runTransaction(transaction => {
      transaction.findOne = () => { throw new Error('CloudBase transaction where() is unsupported') }
      transaction.findMany = () => { throw new Error('CloudBase transaction where() is unsupported') }
      return callback(transaction)
    })
  }
}

test('带图内容、台账和点单只使用事务的 doc(id) 操作', async () => {
  const store = new CloudBaseTransactionStore(pairedSpace())
  const service = createService(store, () => '2026-09-27T00:00:00.000Z', null, { costGuard: { image: true } })
  const recordFileId = 'cloud://test/couples/space-1/records/test.jpg'
  const wishFileId = 'cloud://test/couples/space-1/wishes/test.jpg'
  await service.execute('trackSpaceFile', { fileId: recordFileId }, 'a')
  await service.execute('trackSpaceFile', { fileId: wishFileId }, 'a')
  await service.execute('createMemoryPost', { content: '今天', imageFileId: recordFileId }, 'a')
  await service.execute('createWish', { title: '散步', imageFileId: wishFileId }, 'a')
  assert.equal(store.data.SpaceFileList.length, 2)
  const dish = await service.execute('createDish', { title: '晚餐', category: 'meat', minutes: 15 }, 'a')
  await service.execute('toggleDish', { id: dish._id, selected: true }, 'a')
  const order = await service.execute('completeDinnerOrder', {}, 'a')
  assert.equal(order.items.length, 1)
})

test('已退出成员即使残留旧 spaceId 也不能读取或写入', async () => {
  const seed = pairedSpace()
  seed.UserList[0].memberStatus = 'left'
  const store = new CloudBaseTransactionStore(seed)
  const service = createService(store, () => '2026-09-27T00:00:00.000Z')
  await assert.rejects(() => service.execute('getRecords', {}, 'a'), error => error.code === 'NO_SPACE')
  await assert.rejects(() => service.execute('createHouseRule', { content: '旧空间' }, 'a'), error => error.code === 'NO_SPACE')
  assert.equal(store.data.HouseRuleList.length, 0)
})

test('已退出却残留旧空间编号时仍可重新创建空间或注销个人账号', async () => {
  const seed = pairedSpace()
  seed.UserList[0].memberStatus = 'left'
  const createStore = new CloudBaseTransactionStore(seed)
  const createServiceForUser = createService(createStore, () => '2026-09-27T00:00:00.000Z')
  const created = await createServiceForUser.execute('createSpace', { name: '新的小屋' }, 'a')
  assert.ok(created.spaceId && created.spaceId !== 'space-1')

  const deleteStore = new CloudBaseTransactionStore(seed)
  const deletionService = createService(deleteStore, () => '2026-09-27T00:00:00.000Z')
  assert.deepEqual(await deletionService.execute('deleteAccount', {}, 'a'), { deleted: true })
  assert.equal(deleteStore.data.UserList.some(user => user._openid === 'a'), false)
})

test('已退出账号残留旧空间编号时可接受新的有效邀请', async () => {
  const seed = pairedSpace()
  seed.UserList[0].memberStatus = 'left'
  const service = createService(new CloudBaseTransactionStore(seed), () => '2026-09-27T00:00:00.000Z')
  const invite = await service.execute('regenerateInvite', {}, 'b')
  const preview = await service.execute('getInvite', { inviteToken: invite.inviteToken }, 'a')
  assert.equal(preview.status, 'valid')
  const joined = await service.execute('joinSpace', { inviteToken: invite.inviteToken }, 'a')
  assert.equal(joined.spaceId, 'space-1')
})

test('删除带图记录不删除仍被心愿或点单引用的云图片', async () => {
  const seed = pairedSpace()
  const fileId = 'cloud://test/couples/space-1/records/shared.jpg'
  seed.SpaceFileList = seed.SpaceFileList || []
  seed.MemoryPostList.push({ _id: 'post-shared', _openid: 'a', spaceId: 'space-1', content: '共用图', imageFileId: fileId })
  seed.WishList.push({ _id: 'wish-shared', _openid: 'a', spaceId: 'space-1', title: '旧数据共用图', imageFileId: fileId })
  seed.SpaceFileList.push({ _id: 'file-shared', spaceId: 'space-1', fileId })
  const store = new CloudBaseTransactionStore(seed)
  const deletedFiles = []
  const service = createService(store, () => '2026-09-27T00:00:00.000Z', null, {
    costGuard: { image: true },
    deleteFiles: async ids => { deletedFiles.push(...ids) },
  })
  await service.execute('deleteMemoryPost', { id: 'post-shared' }, 'a')
  assert.deepEqual(deletedFiles, [])
  assert.equal(store.data.SpaceFileList.length, 1)
  assert.equal(store.data.WishList[0].imageFileId, fileId)
  await service.execute('deleteWish', { id: 'wish-shared' }, 'a')
  assert.deepEqual(deletedFiles, [fileId])
})

test('已下单的菜品快照仍引用图片时，删除菜品不能删云文件', async () => {
  const store = new CloudBaseTransactionStore(pairedSpace())
  const deletedFiles = []
  const service = createService(store, () => '2026-09-27T00:00:00.000Z', null, {
    costGuard: { image: true },
    deleteFiles: async ids => { deletedFiles.push(...ids) },
  })
  const fileId = 'cloud://test/couples/space-1/dishes/meal.jpg'
  const dish = await service.execute('createDish', { title: '晚餐', category: 'meat', minutes: 15, imageFileId: fileId }, 'a')
  await service.execute('toggleDish', { id: dish._id, selected: true }, 'a')
  await service.execute('completeDinnerOrder', {}, 'a')
  await service.execute('deleteDish', { id: dish._id }, 'a')
  assert.deepEqual(deletedFiles, [])
  assert.equal(store.data.SpaceFileList.length, 1)
})
