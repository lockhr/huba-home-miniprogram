const test = require('node:test')
const assert = require('node:assert/strict')

const { MemoryStore, pairedSpace } = require('./helpers/memory-store.cjs')
const { createService } = require('../cloudfunctions/api/service.js')

function scheduleInput(action, spaceId) {
  if (action === 'recognizeScheduleImage') {
    return { consent: true, fileId: `cloud://env.bucket/couples/${spaceId}/schedule-import/table.jpg` }
  }
  if (action === 'replaceMySchedule') {
    return {
      confirmed: true,
      term: '2026-2027-1',
      courses: [{ day: 1, title: '数据结构', time: '08:00-09:40', period: '1-2', weeks: '1-16', place: 'A101', teacher: '老师' }],
    }
  }
  return {}
}

function worldWithSpaceId(spaceId) {
  const data = pairedSpace()
  data.CoupleSpaceList[0]._id = spaceId
  data.CoupleSpaceList[0].featureFlags = { schedule: true }
  data.UserList.forEach(user => { user.spaceId = spaceId })
  data.ScheduleList = []
  data.SpaceFileList = []
  return data
}

test('部署未开启时，即使空间残留 schedule=true 也不能调用课表动作', async () => {
  const data = worldWithSpaceId('space-1')
  const service = createService(new MemoryStore(data), () => '2026-10-05T00:00:00.000Z', null, {
    recognizeScheduleImage: async () => ({ items: [] }),
    deleteFiles: async () => {},
  })

  for (const action of ['getSchedule', 'recognizeScheduleImage', 'replaceMySchedule']) {
    await assert.rejects(
      () => service.execute(action, scheduleInput(action, 'space-1'), 'a'),
      error => error.code === 'SCHEDULE_UNAVAILABLE',
      `${action} 必须由服务端拒绝`,
    )
  }
})

test('部署开启后，任意正常空间都拥有课表读取与替换权限', async () => {
  const data = worldWithSpaceId('another-space')
  const store = new MemoryStore(data)
  const service = createService(store, () => '2026-10-05T00:00:00.000Z', null, {
    capabilities: { schedule: true, xiaoba: false },
  })

  assert.deepEqual(await service.execute('getSchedule', {}, 'a'), { callerOpenid: 'a', items: [] })
  assert.deepEqual(await service.execute('replaceMySchedule', scheduleInput('replaceMySchedule', 'another-space'), 'a'), { imported: 1 })
  assert.equal(store.data.ScheduleList.length, 1)
})

test('空间自身可以关闭已部署的课表，但不能重新开启未部署的课表', async () => {
  const data = worldWithSpaceId('space-opt-out')
  data.CoupleSpaceList[0].featureFlags.schedule = false
  const service = createService(new MemoryStore(data), () => '2026-10-05T00:00:00.000Z', null, {
    capabilities: { schedule: true, xiaoba: false },
  })

  await assert.rejects(
    () => service.execute('getSchedule', {}, 'a'),
    error => error.code === 'SCHEDULE_UNAVAILABLE',
  )
})
