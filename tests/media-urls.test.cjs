const { test } = require('node:test')
const assert = require('node:assert/strict')

const { resolveSharedMedia, shouldResolveSharedMedia } = require('../cloudfunctions/api/media-urls.js')

test('shared media resolver adds temporary URLs and preserves cloud file IDs', async () => {
  const data = {
    posts: [{ imageFileId: 'cloud://env/records/a.jpg' }, { imageFileId: '' }],
    dishes: [{ imageFileId: 'cloud://env/dishes/b.jpg' }],
    orders: [{ items: [{ imageFileId: 'cloud://env/dishes/b.jpg' }] }],
  }
  const calls = []
  const resolved = await resolveSharedMedia(data, async fileList => {
    calls.push(fileList)
    return {
      fileList: fileList.map(fileID => ({ fileID, tempFileURL: `https://shared.example/${fileID.split('/').pop()}` })),
    }
  })

  assert.deepEqual(calls, [['cloud://env/records/a.jpg', 'cloud://env/dishes/b.jpg']])
  assert.equal(resolved.posts[0].imageFileId, 'cloud://env/records/a.jpg')
  assert.equal(resolved.posts[0].imageUrl, 'https://shared.example/a.jpg')
  assert.equal(resolved.dishes[0].imageUrl, 'https://shared.example/b.jpg')
  assert.equal(resolved.orders[0].items[0].imageUrl, 'https://shared.example/b.jpg')
})

test('shared media resolver falls back safely when URL signing fails', async () => {
  const data = { posts: [{ imageFileId: 'cloud://env/records/a.jpg' }] }
  const originalWarn = console.warn
  console.warn = () => {}
  let resolved
  try {
    resolved = await resolveSharedMedia(data, async () => { throw new Error('temporary failure') })
  } finally {
    console.warn = originalWarn
  }

  assert.equal(resolved.posts[0].imageFileId, 'cloud://env/records/a.jpg')
  assert.equal(resolved.posts[0].imageUrl, '')
})

test('shared media resolver signs cloud images in batches of fifty', async () => {
  const data = { posts: Array.from({ length: 51 }, (_, index) => ({ imageFileId: `cloud://env/records/${index}.jpg` })) }
  const batchSizes = []
  const resolved = await resolveSharedMedia(data, async fileList => {
    batchSizes.push(fileList.length)
    return { fileList: fileList.map(fileID => ({ fileID, tempFileURL: `https://shared.example/${fileID.split('/').pop()}` })) }
  })

  assert.deepEqual(batchSizes, [50, 1])
  assert.equal(resolved.posts[50].imageUrl, 'https://shared.example/50.jpg')
})

test('wish images receive temporary URLs alongside posts', async () => {
  const data = { posts: [], wishes: [{ imageFileId: 'cloud://env/wishes/a.jpg' }] }
  const resolved = await resolveSharedMedia(data, async fileList => ({ fileList: fileList.map(fileID => ({ fileID, tempFileURL: 'https://shared.example/wish.jpg' })) }))
  assert.equal(resolved.wishes[0].imageUrl, 'https://shared.example/wish.jpg')
})

test('bootstrap resolves shared appearance and both avatars without replacing protected file IDs', async () => {
  const data = {
    user: { avatarFileId: 'cloud://env/couples/space-1/appearance/avatar/a.jpg' },
    partner: { avatarFileId: 'cloud://env/couples/space-1/appearance/avatar/b.jpg' },
    space: {
      _id: 'space-1',
      appearance: {
        heroImageFileId: 'cloud://env/couples/space-1/appearance/hero/hero.jpg',
        welcomeImageFileId: 'cloud://env/couples/space-1/appearance/welcome/letter.jpg',
        missionImageFileId: 'cloud://env/couples/space-1/appearance/mission/plan.jpg',
        storageImageFileId: 'cloud://env/couples/space-1/appearance/storage/box.jpg',
      },
    },
  }
  const resolved = await resolveSharedMedia(data, async fileList => ({
    fileList: fileList.map(fileID => ({ fileID, tempFileURL: `https://shared.example/${fileID.split('/').pop()}` })),
  }))

  assert.equal(resolved.user.avatarFileId, data.user.avatarFileId)
  assert.equal(resolved.partner.avatarFileId, data.partner.avatarFileId)
  assert.equal(resolved.user.avatarUrl, 'https://shared.example/a.jpg')
  assert.equal(resolved.partner.avatarUrl, 'https://shared.example/b.jpg')
  assert.equal(resolved.space.appearance.heroImageFileId, data.space.appearance.heroImageFileId)
  assert.equal(resolved.space.appearance.heroImageUrl, 'https://shared.example/hero.jpg')
  assert.equal(resolved.space.appearance.welcomeImageUrl, 'https://shared.example/letter.jpg')
  assert.equal(resolved.space.appearance.missionImageUrl, 'https://shared.example/plan.jpg')
  assert.equal(resolved.space.appearance.storageImageUrl, 'https://shared.example/box.jpg')
})

test('bootstrap is included in shared media URL resolution actions', () => {
  assert.equal(shouldResolveSharedMedia('getBootstrap'), true)
  assert.equal(shouldResolveSharedMedia('getRecords'), true)
  assert.equal(shouldResolveSharedMedia('getDinnerData'), true)
  assert.equal(shouldResolveSharedMedia('setSpaceAppearance'), true)
  assert.equal(shouldResolveSharedMedia('setMyAvatarImage'), true)
  assert.equal(shouldResolveSharedMedia('getSession'), false)
})

test('appearance write response also returns an immediate signed display URL', async () => {
  const data = { slot: 'hero', imageFileId: 'cloud://env/couples/space-1/appearance/hero/new.jpg' }
  const resolved = await resolveSharedMedia(data, async fileList => ({
    fileList: fileList.map(fileID => ({ fileID, tempFileURL: 'https://shared.example/new.jpg' })),
  }))
  assert.equal(resolved.imageFileId, data.imageFileId)
  assert.equal(resolved.imageUrl, 'https://shared.example/new.jpg')
})

test('bootstrap never signs or returns appearance references from another space', async () => {
  const foreignAvatar = 'cloud://env/couples/space-2/appearance/avatar/old.jpg'
  const foreignHero = 'cloud://env/couples/space-2/appearance/hero/old.jpg'
  const data = {
    user: { avatarFileId: foreignAvatar },
    partner: { avatarFileId: '' },
    space: { _id: 'space-1', appearance: { heroImageFileId: foreignHero } },
  }
  const signed = []
  const resolved = await resolveSharedMedia(data, async fileList => {
    signed.push(...fileList)
    return { fileList: [] }
  })

  assert.deepEqual(signed, [])
  assert.equal(resolved.user.avatarFileId, '')
  assert.equal(resolved.user.avatarUrl, '')
  assert.equal(resolved.space.appearance.heroImageFileId, '')
  assert.equal(resolved.space.appearance.heroImageUrl, '')
})
