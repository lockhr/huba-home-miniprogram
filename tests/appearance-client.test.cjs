const test = require('node:test')
const assert = require('node:assert/strict')

const {
  APPEARANCE_SLOTS,
  DEFAULT_APPEARANCE_IMAGES,
  appearanceDisplayCustom,
  appearanceView,
  avatarViewModel,
  createAppearanceUploader,
  refreshPageAppearance,
  safeUploadFolder,
} = require('../miniprogram/utils/appearance.js')

const EXPECTED_SPACE_SLOTS = [
  'hero', 'anniversary', 'rules', 'welcome',
  'mission', 'market', 'records', 'dinner', 'storage',
]

function harness(options = {}) {
  const calls = []
  const fileId = 'cloud://env.bucket/couples/space-1/appearance/hero/a.jpg'
  const wxApi = {
    chooseMedia(config) {
      calls.push({ kind: 'choose', config })
      if (options.cancel) config.fail({ errMsg: 'chooseMedia:fail cancel' })
      else config.success({ tempFiles: [{ tempFilePath: '/tmp/photo.jpg', size: options.size || 1024 }] })
    },
  }
  const cloud = {
    async uploadFile(value) { calls.push({ kind: 'upload', value }); return { fileID: fileId } },
    async deleteFile(value) { calls.push({ kind: 'delete', value }) },
  }
  const app = {
    ensureWritable: () => options.writable !== false,
    async spaceUploadPath(folder) { calls.push({ kind: 'path', folder }); return `couples/space-1/${folder}/a.jpg` },
    cloud: () => cloud,
    async api(action, data) {
      calls.push({ kind: 'api', action, data })
      if (options.apiError) throw new Error('save failed')
      return action === 'setSpaceAppearance'
        ? { slot: data.slot, imageFileId: data.imageFileId }
        : { imageFileId: data.imageFileId }
    },
    async loadBootstrap() {
      calls.push({ kind: 'bootstrap' })
      if (options.bootstrapError) throw new Error('refresh failed')
      return options.committed
        ? { user: { avatarFileId: fileId }, space: { appearance: { heroImageFileId: fileId } } }
        : { user: { avatarFileId: '' }, space: { appearance: {} } }
    },
  }
  return { uploader: createAppearanceUploader({ wxApi, app }), calls, fileId }
}

test('装扮视图没有云图片时使用随包默认资源', () => {
  assert.deepEqual(APPEARANCE_SLOTS.map(item => item.key), EXPECTED_SPACE_SLOTS)
  assert.deepEqual(Object.keys(DEFAULT_APPEARANCE_IMAGES), EXPECTED_SPACE_SLOTS)
  assert.deepEqual(appearanceView({}), DEFAULT_APPEARANCE_IMAGES)
  assert.deepEqual(appearanceView({ appearance: { heroImageFileId: 'cloud://hero' } }), {
    ...DEFAULT_APPEARANCE_IMAGES,
    hero: 'cloud://hero',
  })
  assert.deepEqual(avatarViewModel({ avatarKey: 'rabbit' }), { imageFileId: '', glyph: '🐰' })
  assert.deepEqual(avatarViewModel({ avatarKey: 'rabbit', avatarFileId: 'cloud://avatar' }), { imageFileId: 'cloud://avatar', glyph: '🐰' })
})

test('九个共享图片位都优先使用签发地址，失败时各自回退默认图', () => {
  const appearance = {}
  for (const slot of APPEARANCE_SLOTS) {
    appearance[slot.field] = `cloud://${slot.key}`
    appearance[slot.field.replace(/FileId$/, 'Url')] = `https://shared.example/${slot.key}.jpg`
  }
  const view = appearanceView({ appearance })
  for (const key of EXPECTED_SPACE_SLOTS) assert.equal(view[key], `https://shared.example/${key}.jpg`)

  for (const slot of APPEARANCE_SLOTS) appearance[slot.field.replace(/FileId$/, 'Url')] = ''
  assert.deepEqual(appearanceView({ appearance }), DEFAULT_APPEARANCE_IMAGES)
})

test('业务页面回到前台时刷新 bootstrap，让伴侣看到刚替换的图片', async () => {
  const patches = []
  let loads = 0
  const app = {
    globalData: { space: null },
    async loadBootstrap() {
      loads += 1
      this.globalData.space = { appearance: {
        missionImageFileId: 'cloud://mission',
        missionImageUrl: 'https://shared.example/mission-new.jpg',
      } }
    },
  }
  const images = await refreshPageAppearance({ setData: patch => patches.push(patch) }, app)
  assert.equal(loads, 1)
  assert.equal(images.mission, 'https://shared.example/mission-new.jpg')
  assert.equal(patches.at(-1).appearance.mission, 'https://shared.example/mission-new.jpg')
  assert.equal(patches.at(-1).appearanceDisplayCustom.mission, true)
})

test('主页展示优先使用服务端签发地址，同时保留原文件 ID 作为后备', () => {
  assert.equal(appearanceView({ appearance: {
    heroImageFileId: 'cloud://hero',
    heroImageUrl: 'https://shared.example/hero.jpg',
  } }).hero, 'https://shared.example/hero.jpg')
  assert.deepEqual(avatarViewModel({
    avatarKey: 'rabbit',
    avatarFileId: 'cloud://avatar',
    avatarUrl: 'https://shared.example/avatar.jpg',
  }), { imageFileId: 'https://shared.example/avatar.jpg', glyph: '🐰' })
})

test('服务端明确签发失败时回退默认图和头像图标，不渲染对方无权读取的云地址', () => {
  assert.equal(appearanceView({ appearance: {
    heroImageFileId: 'cloud://hero',
    heroImageUrl: '',
  } }).hero, DEFAULT_APPEARANCE_IMAGES.hero)
  assert.deepEqual(avatarViewModel({
    avatarKey: 'rabbit',
    avatarFileId: 'cloud://avatar',
    avatarUrl: '',
  }), { imageFileId: '', glyph: '🐰' })
  assert.equal(appearanceDisplayCustom({ appearance: {
    recordsImageFileId: 'cloud://records', recordsImageUrl: '',
  } }).records, false)
  assert.equal(appearanceDisplayCustom({ appearance: {
    recordsImageFileId: 'cloud://records', recordsImageUrl: 'https://shared.example/records.jpg',
  } }).records, true)
})

test('选图后直接上传到对应装扮目录并保存共享槽位', async () => {
  const { uploader, calls, fileId } = harness()
  const result = await uploader.replace({ kind: 'space', slot: 'hero' })

  assert.equal(calls.find(call => call.kind === 'path').folder, 'appearance/hero')
  assert.equal(calls.find(call => call.kind === 'upload').value.cloudPath, 'couples/space-1/appearance/hero/a.jpg')
  assert.deepEqual(calls.find(call => call.kind === 'api'), {
    kind: 'api', action: 'setSpaceAppearance', data: { slot: 'hero', imageFileId: fileId },
  })
  assert.deepEqual(result, { slot: 'hero', imageFileId: fileId })
})

test('本人头像写入 avatar 目录并调用本人专用接口', async () => {
  const { uploader, calls, fileId } = harness()
  await uploader.replace({ kind: 'avatar' })
  assert.equal(calls.find(call => call.kind === 'path').folder, 'appearance/avatar')
  assert.deepEqual(calls.find(call => call.kind === 'api'), {
    kind: 'api', action: 'setMyAvatarImage', data: { imageFileId: fileId },
  })
})

test('超限、取消或只读状态都不会上传', async () => {
  const tooLarge = harness({ size: 5 * 1024 * 1024 + 1 })
  await assert.rejects(() => tooLarge.uploader.replace({ kind: 'space', slot: 'hero' }), /5MB/)
  assert.equal(tooLarge.calls.some(call => call.kind === 'upload'), false)

  const cancelled = harness({ cancel: true })
  assert.deepEqual(await cancelled.uploader.replace({ kind: 'space', slot: 'hero' }), { cancelled: true })
  assert.equal(cancelled.calls.some(call => call.kind === 'upload'), false)

  const readOnly = harness({ writable: false })
  assert.deepEqual(await readOnly.uploader.replace({ kind: 'space', slot: 'hero' }), { cancelled: true })
  assert.equal(readOnly.calls.length, 0)
})

test('云端保存失败时删除本次新上传文件', async () => {
  const { uploader, calls, fileId } = harness({ apiError: true })
  await assert.rejects(() => uploader.replace({ kind: 'space', slot: 'hero' }), /save failed/)
  assert.deepEqual(calls.find(call => call.kind === 'delete').value.fileList, [fileId])
})

test('响应丢失时先刷新引用，已提交的新图绝不删除', async () => {
  const committed = harness({ apiError: true, committed: true })
  assert.deepEqual(
    await committed.uploader.replace({ kind: 'space', slot: 'hero' }),
    { slot: 'hero', imageFileId: committed.fileId, recovered: true },
  )
  assert.equal(committed.calls.some(call => call.kind === 'delete'), false)

  const unknown = harness({ apiError: true, bootstrapError: true })
  await assert.rejects(() => unknown.uploader.replace({ kind: 'space', slot: 'hero' }), /save failed/)
  assert.equal(unknown.calls.some(call => call.kind === 'delete'), false)
})

test('恢复默认不上传文件，只清空对应引用', async () => {
  const { uploader, calls } = harness()
  assert.deepEqual(await uploader.reset({ kind: 'space', slot: 'welcome' }), { slot: 'welcome', imageFileId: '' })
  assert.deepEqual(await uploader.reset({ kind: 'avatar' }), { imageFileId: '' })
  assert.equal(calls.some(call => call.kind === 'choose' || call.kind === 'upload'), false)
})

test('上传目录禁止路径穿越和空目录段', () => {
  assert.equal(safeUploadFolder('appearance/hero'), 'appearance/hero')
  for (const value of ['../records', 'appearance//hero', '/appearance/hero', 'appearance/../hero', 'appearance\\hero']) {
    assert.throws(() => safeUploadFolder(value), /上传目录/)
  }
})
