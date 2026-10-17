// M5：迁移脚本。三条硬约束——幂等、不删数据、可预演。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const migrate = require('../scripts/migrate-space.cjs')
const { MANAGED_COLLECTIONS, countScheduleEntries, parseCollectionText, planMigration, statsOf } = migrate

const SPACE = 'space-migrated'
const SCRIPT = path.join(__dirname, '..', 'scripts', 'migrate-space.cjs')

// 旧版导出：两个成员，谁都没有 spaceId，也没有空间记录。
function legacyExport() {
  return {
    CoupleSpaceList: [],
    PairInviteList: [{ _id: 'invite-old', inviterOpenid: 'a', status: 'active' }],
    UserList: [
      { _id: 'user-a', _openid: 'a', credit: 12, subscribeCount: 3 },
      { _id: 'user-b', _openid: 'b', credit: 5, displayName: '小柚' },
    ],
    MissionList: [
      { _id: 'mission-1', _openid: 'a', title: '一起散步', credit: 8, available: true },
      { _id: 'mission-2', _openid: 'b', title: '做一次早饭', credit: 3, available: false },
    ],
    MarketList: [{ _id: 'item-1', _openid: 'b', title: '奶茶', credit: 2, available: true }],
    StorageList: [{ _id: 'storage-1', _openid: 'a', title: '奶茶', available: true }],
    HouseRuleList: [{ _id: 'rule-1', _openid: 'a', content: '有话直说' }],
    MenuList: [{ _id: 'dish-1', _openid: 'a', title: '番茄牛腩', category: 'meat', minutes: 40, selected: false }],
    DinnerOrderList: [{ _id: 'order-1', _openid: 'a', items: [] }],
    MemoryPostList: [{ _id: 'post-1', _openid: 'b', content: '一起看晚霞', likedBy: [], comments: [] }],
    WishList: [{ _id: 'wish-1', _openid: 'a', title: '去看海', completed: false }],
    ScheduleList: [],
  }
}

function withTempDir(prefix, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  try {
    return run(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('解析控制台导出：数组、包一层 data、JSON Lines 都认', () => {
  assert.deepEqual(parseCollectionText('[{"_id":"a"}]'), [{ _id: 'a' }])
  assert.deepEqual(parseCollectionText('{"data":[{"_id":"a"}]}'), [{ _id: 'a' }])
  assert.deepEqual(parseCollectionText('{"records":[{"_id":"a"}]}'), [{ _id: 'a' }])
  assert.deepEqual(parseCollectionText('{"_id":"only"}\n'), [{ _id: 'only' }])
  assert.deepEqual(parseCollectionText('{"_id":"a"}\n{"_id":"b"}\n'), [{ _id: 'a' }, { _id: 'b' }])
  assert.deepEqual(parseCollectionText('   '), [])
  assert.throws(() => parseCollectionText('{"total":1}'), /既不是数组/)
})

test('课表条目数按 days 里的课程算，形状不对时算 0', () => {
  assert.equal(countScheduleEntries({ days: { 1: [{}, {}], 3: [{}] } }), 3)
  assert.equal(countScheduleEntries({ days: {} }), 0)
  assert.equal(countScheduleEntries({ days: [] }), 0)
  assert.equal(countScheduleEntries({}), 0)
  assert.equal(countScheduleEntries(null), 0)
})

test('首次迁移：建空间、两名成员就位、业务记录补 spaceId', () => {
  const before = legacyExport()
  const plan = planMigration(before, { spaceId: SPACE, spaceName: '我们的空间', anniversaryDate: '2020-01-02', now: '2026-09-16T00:00:00.000Z' })

  assert.equal(plan.changes.createdSpace, true)
  assert.equal(plan.space._id, SPACE)
  assert.equal(plan.space.status, 'active')
  assert.equal(plan.space.anniversaryDate, '2020-01-02')
  assert.equal(plan.space.createdBy, 'a')
  assert.equal(plan.changes.users, 2)
  assert.equal(plan.changes.records, 9)
  assert.equal(plan.changes.alreadyScoped, 0)

  const users = plan.collections.UserList
  assert.equal(users.every(row => row.spaceId === SPACE && row.memberStatus === 'active'), true)
  assert.equal(users[1].displayName, '小柚', '原有昵称不能被覆盖')
  assert.equal(users[0].displayName, '成员1', '没有昵称的补一个占位名')
  assert.equal(users[0].subscribeCount, 3, '其他字段保持原样')

  for (const name of migrate.SCOPED_COLLECTIONS) {
    for (const row of plan.collections[name]) assert.equal(row.spaceId, SPACE)
  }
})

test('迁移前后比对：积分、任务、仓库、照片、课表口径都不丢', () => {
  const before = legacyExport()
  const plan = planMigration(before, { spaceId: SPACE, anniversaryDate: '2020-01-02' })
  const { statsBefore, statsAfter } = plan

  assert.equal(statsBefore.totalCredit, 17)
  assert.equal(statsAfter.totalCredit, statsBefore.totalCredit)
  assert.equal(statsBefore.pendingMissions, 1)
  assert.equal(statsAfter.pendingMissions, statsBefore.pendingMissions)
  assert.equal(statsAfter.completedMissions, statsBefore.completedMissions)
  assert.equal(statsAfter.storageItems, statsBefore.storageItems)
  assert.equal(statsBefore.recordPhotos, 0)
  assert.equal(statsAfter.recordPhotos, statsBefore.recordPhotos)
  // 只有记录数会增加（新建了空间），没有任何一项变少
  for (const name of MANAGED_COLLECTIONS) {
    assert.ok(statsAfter.recordCounts[name] >= statsBefore.recordCounts[name], `${name} 记录数不能减少`)
  }
  assert.ok(statsAfter.totalRecords > statsBefore.totalRecords)
})

test('旧版无空间前缀图片会回填受信任文件台账且重复运行不重复', () => {
  const before = legacyExport()
  before.MemoryPostList.push({ _id: 'legacy-photo', _openid: 'a', content: '旧图', imageFileId: 'cloud://env.bucket/records/p1.jpg' })
  const first = planMigration(before, { spaceId: SPACE, anniversaryDate: '2020-01-02' })
  const ledger = first.collections.SpaceFileList
  assert.equal(ledger.length, 1)
  assert.equal(ledger[0].fileId, 'cloud://env.bucket/records/p1.jpg')
  assert.equal(ledger[0].spaceId, SPACE)
  assert.equal(ledger[0].legacyTrusted, true)
  assert.equal(first.changes.createdFileLedger, 1)
  const second = planMigration(first.collections, { spaceId: SPACE, anniversaryDate: '2020-01-02' })
  assert.equal(second.collections.SpaceFileList.length, 1)
  assert.equal(second.changes.createdFileLedger, 0)
})

test('不删数据：每条旧记录都还在，没被改动的字段一模一样', () => {
  const before = legacyExport()
  const plan = planMigration(before, { spaceId: SPACE, anniversaryDate: '2020-01-02' })

  for (const name of MANAGED_COLLECTIONS) {
    const afterRows = plan.collections[name]
    for (const oldRow of before[name] || []) {
      const newRow = afterRows.find(row => row._id === oldRow._id)
      assert.ok(newRow, `${name} 里的 ${oldRow._id} 丢了`)
      for (const [key, value] of Object.entries(oldRow)) {
        assert.deepEqual(newRow[key], value, `${name}.${oldRow._id}.${key} 被改动了`)
      }
    }
  }
})

test('幂等：把迁移结果再迁一次，变更数为 0 且内容完全一致', () => {
  const first = planMigration(legacyExport(), { spaceId: SPACE, anniversaryDate: '2020-01-02' })
  const second = planMigration(first.collections, { spaceId: SPACE, anniversaryDate: '2020-01-02' })

  assert.equal(second.changes.createdSpace, false)
  assert.equal(second.changes.users, 0)
  assert.equal(second.changes.records, 0)
  assert.equal(second.changes.createdSchedule, 0)
  assert.equal(second.changes.alreadyScoped, 11)
  assert.deepEqual(second.collections, first.collections)
  assert.deepEqual(second.statsAfter, second.statsBefore)
})

test('属于别的空间的记录原样跳过，不动也不报错', () => {
  const before = legacyExport()
  before.MissionList.push({ _id: 'mission-other', _openid: 'x', spaceId: 'other-space', title: '别家的任务', credit: 5, available: true })
  const plan = planMigration(before, { spaceId: SPACE, anniversaryDate: '2020-01-02' })

  assert.equal(plan.changes.foreign.length, 1)
  assert.equal(plan.changes.foreign[0]._id, 'mission-other')
  assert.equal(plan.collections.MissionList.find(row => row._id === 'mission-other').spaceId, 'other-space')
  assert.equal(plan.warnings.some(text => text.includes('属于别的空间')), true)
})

test('旧邀请没有 spaceId 时不动它，只提示', () => {
  const plan = planMigration(legacyExport(), { spaceId: SPACE, anniversaryDate: '2020-01-02' })
  assert.equal(plan.collections.PairInviteList[0].spaceId, undefined)
  assert.equal(plan.warnings.some(text => text.includes('旧邀请')), true)
})

test('课表按角色配 openid 迁进去，重复运行不会写第二份', () => {
  const schedule = { memberA: { 1: [{ title: '课' }] }, memberB: { 2: [{ title: '课' }, { title: '课' }] } }
  const first = planMigration(legacyExport(), {
    spaceId: SPACE,
    anniversaryDate: '2020-01-02',
    schedule,
    scheduleOwners: { memberA: 'a', memberB: 'b' },
    term: '2026-2027-1',
  })

  assert.equal(first.changes.createdSchedule, 2)
  assert.equal(first.statsAfter.scheduleOwners, 2)
  assert.equal(first.statsAfter.scheduleEntries, 3)
  assert.equal(first.collections.CoupleSpaceList[0].featureFlags.schedule, true)
  assert.equal(first.collections.ScheduleList.every(row => row.spaceId === SPACE && row.term === '2026-2027-1'), true)
  assert.deepEqual(first.collections.ScheduleList.map(row => row._openid).sort(), ['a', 'b'])

  const second = planMigration(first.collections, {
    spaceId: SPACE,
    anniversaryDate: '2020-01-02',
    schedule,
    scheduleOwners: { memberA: 'a', memberB: 'b' },
    term: '2026-2027-1',
  })
  assert.equal(second.changes.createdSchedule, 0)
  assert.equal(second.collections.ScheduleList.length, 2)
})

test('课表角色没配 openid 时跳过并提示，不模糊猜测归属', () => {
  const plan = planMigration(legacyExport(), {
    spaceId: SPACE,
    anniversaryDate: '2020-01-02',
    schedule: { memberA: { 1: [{}] }, memberB: { 1: [{}] } },
    scheduleOwners: { memberA: 'a' },
  })
  assert.equal(plan.changes.createdSchedule, 1)
  assert.equal(plan.warnings.some(text => text.includes('memberB')), true)
})

test('课表已经是目标形状（数组带 openid）时直接用', () => {
  const plan = planMigration(legacyExport(), {
    spaceId: SPACE,
    anniversaryDate: '2020-01-02',
    schedule: [{ openid: 'a', term: 'T', days: { 1: [{}] } }, { term: 'T' }],
  })
  assert.equal(plan.changes.createdSchedule, 1)
  assert.equal(plan.collections.ScheduleList[0]._openid, 'a')
  assert.equal(plan.warnings.some(text => text.includes('没有 openid')), true)
})

test('照片只出台账：列出本地文件到云端路径的映射，不动数据库', () => {
  withTempDir('rainbow-cats-photos-', dir => {
    fs.writeFileSync(path.join(dir, 'a.jpg'), 'x')
    fs.writeFileSync(path.join(dir, 'b.PNG'), 'x')
    fs.writeFileSync(path.join(dir, 'note.txt'), 'x')
    const plan = planMigration(legacyExport(), { spaceId: SPACE, anniversaryDate: '2020-01-02', photoDir: dir })

    assert.equal(plan.photos.length, 2, '只认图片扩展名')
    assert.equal(plan.photos[0].cloudPath, `couples/${SPACE}/memories/a.jpg`)
    assert.equal(plan.photos[1].cloudPath, `couples/${SPACE}/memories/b.PNG`)
    assert.equal(plan.statsAfter.localPhotos, 2)
    assert.equal(plan.statsBefore.localPhotos, 2)
    assert.equal(plan.changes.records, 9, '默认不因为照片产生记录')
  })
})

test('显式开启后照片变成空间里的共同记录，重复运行不重复插', () => {
  withTempDir('rainbow-cats-photos-', dir => {
    fs.writeFileSync(path.join(dir, 'a.jpg'), 'x')
    const options = {
      spaceId: SPACE,
      anniversaryDate: '2020-01-02',
      photoDir: dir,
      photosAsPosts: true,
      photoOwner: 'a',
      fileIdPrefix: 'cloud://env.bucket',
      now: '2026-09-16T00:00:00.000Z',
    }
    const first = planMigration(legacyExport(), options)
    assert.equal(first.changes.records, 10)
    const row = first.collections.MemoryPostList.find(item => item.imageFileId)
    assert.equal(row.imageFileId, `cloud://env.bucket/couples/${SPACE}/memories/a.jpg`)
    assert.equal(row._openid, 'a')
    assert.equal(row.spaceId, SPACE)

    const second = planMigration(first.collections, options)
    assert.equal(second.changes.records, 0)
    assert.equal(second.collections.MemoryPostList.length, first.collections.MemoryPostList.length)
  })
})

test('开启照片记录但缺参数时直接报错，不静默产出无主记录', () => {
  withTempDir('rainbow-cats-photos-', dir => {
    fs.writeFileSync(path.join(dir, 'a.jpg'), 'x')
    const base = { spaceId: SPACE, photoDir: dir, photosAsPosts: true, fileIdPrefix: 'cloud://env.bucket' }
    assert.throws(() => planMigration(legacyExport(), base), /--photo-owner/)
    assert.throws(() => planMigration(legacyExport(), { ...base, photoOwner: 'a', fileIdPrefix: '' }), /--file-id-prefix/)
  })
})

test('空间编号非法时拒绝执行', () => {
  assert.throws(() => planMigration(legacyExport(), {}), /缺少目标空间编号/)
  assert.throws(() => planMigration(legacyExport(), { spaceId: '空间 1' }), /不能包含空白/)
  assert.throws(() => planMigration(legacyExport(), { spaceId: 'x'.repeat(129) }), /128/)
})

test('没有传纪念日时留空并明确提示', () => {
  const plan = planMigration(legacyExport(), { spaceId: SPACE })
  assert.equal(plan.space.anniversaryDate, '')
  assert.equal(plan.warnings.some(text => text.includes('--anniversary')), true)
})

test('成员数不是 2 时提示导出可能不完整', () => {
  const before = legacyExport()
  before.UserList.pop()
  const plan = planMigration(before, { spaceId: SPACE, anniversaryDate: '2020-01-02' })
  assert.equal(plan.warnings.some(text => text.includes('不是 2 条')), true)
})

// ---------------------------------------------------------------- CLI

function runCli(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
}

function writeExport(dir) {
  fs.writeFileSync(path.join(dir, 'UserList.json'), JSON.stringify(legacyExport().UserList, null, 2), 'utf8')
  fs.writeFileSync(path.join(dir, 'MissionList.json'), JSON.stringify(legacyExport().MissionList, null, 2), 'utf8')
}

test('CLI：--dry-run 只打报告，一个文件都不写', () => {
  withTempDir('rainbow-cats-migrate-', root => {
    const input = path.join(root, 'export')
    const output = path.join(root, 'after')
    const photos = path.join(root, 'photos')
    fs.mkdirSync(input)
    fs.mkdirSync(photos)
    writeExport(input)

    const result = runCli('--input', input, '--space-id', SPACE, '--output', output, '--dry-run', '--no-schedule', '--photos-dir', photos)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /预览模式/)
    assert.match(result.stdout, /迁移前后比对/)
    assert.equal(fs.existsSync(output), false, '预览模式不该创建输出目录')
  })
})

test('CLI：没确认备份就拒绝写文件', () => {
  withTempDir('rainbow-cats-migrate-', root => {
    const input = path.join(root, 'export')
    const output = path.join(root, 'after')
    fs.mkdirSync(input)
    writeExport(input)

    const result = runCli('--input', input, '--space-id', SPACE, '--output', output, '--no-schedule')
    assert.equal(result.status, 1)
    assert.match(result.stdout + result.stderr, /--confirm-backup/)
    assert.equal(fs.existsSync(output), false)
  })
})

test('CLI：确认备份后写出集合与报告，二次运行变更数为 0', () => {
  withTempDir('rainbow-cats-migrate-', root => {
    const input = path.join(root, 'export')
    const output = path.join(root, 'after')
    const second = path.join(root, 'after-again')
    const photos = path.join(root, 'photos')
    fs.mkdirSync(input)
    fs.mkdirSync(photos)
    writeExport(input)

    const args = ['--space-id', SPACE, '--no-schedule', '--photos-dir', photos, '--confirm-backup', '--anniversary', '2020-01-02']
    const first = runCli('--input', input, '--output', output, ...args)
    assert.equal(first.status, 0, first.stderr)
    for (const name of MANAGED_COLLECTIONS) {
      assert.equal(fs.existsSync(path.join(output, `${name}.json`)), true, `${name}.json 没写出来`)
    }
    const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'))
    assert.equal(report.spaceId, SPACE)
    assert.equal(report.changes.createdSpace, true)
    assert.equal(report.changes.users, 2)
    assert.equal(report.changes.records, 2)
    assert.match(fs.readFileSync(path.join(output, 'report.md'), 'utf8'), /迁移前后比对/)

    const again = runCli('--input', output, '--output', second, ...args)
    assert.equal(again.status, 0, again.stderr)
    const secondReport = JSON.parse(fs.readFileSync(path.join(second, 'report.json'), 'utf8'))
    assert.equal(secondReport.changes.createdSpace, false)
    assert.equal(secondReport.changes.users, 0)
    assert.equal(secondReport.changes.records, 0)
    assert.deepEqual(secondReport.statsAfter, secondReport.statsBefore)
  })
})

test('CLI：参数缺失与目录不存在时给出可读的报错', () => {
  const empty = runCli()
  assert.equal(empty.status, 1)
  assert.match(empty.stdout + empty.stderr, /--input/)

  withTempDir('rainbow-cats-migrate-', root => {
    const result = runCli('--input', path.join(root, 'nope'), '--space-id', SPACE, '--dry-run')
    assert.equal(result.status, 1)
    assert.match(result.stdout + result.stderr, /导出目录不存在/)
  })
})

test('CLI：输出目录与导出目录相同时拒绝执行', () => {
  withTempDir('rainbow-cats-migrate-', root => {
    const input = path.join(root, 'export')
    fs.mkdirSync(input)
    writeExport(input)
    const result = runCli('--input', input, '--output', input, '--space-id', SPACE, '--confirm-backup', '--no-schedule')
    assert.equal(result.status, 1)
    assert.match(result.stdout + result.stderr, /不能和导出目录相同/)
  })
})

test('statsOf 对空数据不炸', () => {
  const stats = statsOf({})
  assert.equal(stats.totalRecords, 0)
  assert.equal(stats.totalCredit, 0)
  assert.equal(stats.scheduleEntries, 0)
})
