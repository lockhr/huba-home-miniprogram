// 旧版数据迁移：把两位旧用户的导出数据搬进一个专属空间。
//
// 为什么操作导出文件而不是直连云数据库：
//   · 仓库里不放、也不该放云环境密钥；
//   · 云开发控制台本身提供集合的导出/导入，导出文件天然就是备份；
//   · 不连网就能跑、能被 node --test 覆盖，迁移逻辑出错时不会碰到线上数据。
//
// 三条硬约束（对应计划 M5）：
//   1) 幂等——重复运行不产生第二份数据，二次运行的变更数必须是 0；
//   2) 不删数据——只补字段、只新增记录，绝不删除或覆盖已有内容；
//   3) 可预演——--dry-run 只输出报告，一个字节都不写。
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const SPACE_COLLECTION = 'CoupleSpaceList'
const USER_COLLECTION = 'UserList'
const INVITE_COLLECTION = 'PairInviteList'
const SCHEDULE_COLLECTION = 'ScheduleList'
const FILE_COLLECTION = 'SpaceFileList'

// 业务集合：迁移时逐条补 spaceId。顺序与 service.js 的 SHARED_LISTS 保持一致。
const SCOPED_COLLECTIONS = [
  'MissionList',
  'MarketList',
  'StorageList',
  'HouseRuleList',
  'MenuList',
  'DinnerOrderList',
  'MemoryPostList',
  'WishList',
  SCHEDULE_COLLECTION,
]

const MANAGED_COLLECTIONS = [SPACE_COLLECTION, INVITE_COLLECTION, USER_COLLECTION, FILE_COLLECTION, ...SCOPED_COLLECTIONS]

// 照片目标目录：couples/<spaceId>/memories/<文件名>，与 M4 的服务端前缀校验一致。
const PHOTO_FOLDER = 'memories'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

// 控制台导出可能是「JSON 数组」，也可能是「每行一条记录的 JSON Lines」。
// 先按整段解析，失败才退回逐行——不能只看首字符，JSON Lines 也是以 { 开头的。
function parseCollectionText(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return []
  let parsed
  let wholeIsJson = true
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    wholeIsJson = false
  }
  if (wholeIsJson) {
    if (Array.isArray(parsed)) return parsed
    for (const key of ['data', 'list', 'records', 'items']) {
      if (Array.isArray(parsed[key])) return parsed[key]
    }
    if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, '_id')) return [parsed]
    throw new Error('导出的 JSON 既不是数组，也没有 data/list/records/items 数组字段')
  }
  return trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error('无法解析导出文件：既不是 JSON，也不是 JSON Lines')
      }
    })
}

function readCollections(dir) {
  const collections = {}
  const found = []
  for (const name of MANAGED_COLLECTIONS) {
    const candidates = [name + '.json', name + '.jsonl', name.toLowerCase() + '.json', name.toLowerCase() + '.jsonl']
    const file = candidates.map(candidate => path.join(dir, candidate)).find(candidate => fs.existsSync(candidate))
    collections[name] = file ? parseCollectionText(fs.readFileSync(file, 'utf8')) : []
    if (file) found.push(name)
  }
  return { collections, found }
}

function listOf(collections, name) {
  return Array.isArray(collections[name]) ? collections[name] : []
}

// 课表条目数：ScheduleList.days 是以「星期数字字符串」为键的对象。
function countScheduleEntries(row) {
  const days = row && row.days
  if (!days || typeof days !== 'object' || Array.isArray(days)) return 0
  return Object.values(days).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0)
}

// 迁移前后的比对口径（设计稿 §10 第 6 步）。
function statsOf(collections) {
  const users = listOf(collections, USER_COLLECTION)
  const missions = listOf(collections, 'MissionList')
  const storage = listOf(collections, 'StorageList')
  const schedules = listOf(collections, SCHEDULE_COLLECTION)
  const withPhoto = listOf(collections, 'MemoryPostList')
    .concat(listOf(collections, 'MenuList'))
    .filter(row => row && typeof row.imageFileId === 'string' && row.imageFileId)
  const recordCounts = {}
  let totalRecords = 0
  for (const name of MANAGED_COLLECTIONS) {
    recordCounts[name] = listOf(collections, name).length
    totalRecords += recordCounts[name]
  }
  return {
    recordCounts,
    totalRecords,
    totalCredit: users.reduce((sum, user) => sum + (Number(user.credit) || 0), 0),
    pendingMissions: missions.filter(row => row.available !== false).length,
    completedMissions: missions.filter(row => row.available === false).length,
    storageItems: storage.length,
    storageUnused: storage.filter(row => row.available !== false).length,
    recordPhotos: withPhoto.length,
    scheduleOwners: schedules.length,
    scheduleEntries: schedules.reduce((sum, row) => sum + countScheduleEntries(row), 0),
  }
}

function photoUploads(photoDir, spaceId) {
  if (!photoDir || !fs.existsSync(photoDir)) return []
  return fs.readdirSync(photoDir)
    .filter(name => /\.(?:jpg|jpeg|png|webp)$/i.test(name))
    .sort()
    .map(name => ({
      local: path.join(photoDir, name),
      cloudPath: `couples/${spaceId}/${PHOTO_FOLDER}/${name}`,
    }))
}

// 纯函数：给一份导出数据和一个目标空间，算出「迁移后应该长什么样」。
// 不读文件、不写文件，方便测试直接喂数据。
function planMigration(collections, options = {}) {
  const spaceId = typeof options.spaceId === 'string' ? options.spaceId.trim() : ''
  if (!spaceId) throw new Error('缺少目标空间编号 spaceId')
  if (/\s/.test(spaceId) || spaceId.length > 128) throw new Error('空间编号不能包含空白且不超过 128 个字符')

  const stamp = options.now || new Date().toISOString()
  const warnings = []
  const after = {}
  for (const name of MANAGED_COLLECTIONS) after[name] = clone(listOf(collections, name))

  const changes = {
    createdSpace: false,
    users: 0,
    records: 0,
    createdSchedule: 0,
    createdFileLedger: 0,
    alreadyScoped: 0,
    foreign: [],
    byCollection: {},
  }

  // ---- 1. 空间本身 ----
  let space = after[SPACE_COLLECTION].find(row => row && row._id === spaceId) || null
  if (!space) {
    const owners = after[USER_COLLECTION].map(row => row && row._openid).filter(Boolean)
    space = {
      _id: spaceId,
      name: options.spaceName || '我们的空间',
      anniversaryDate: options.anniversaryDate || '',
      status: 'active',
      featureFlags: {},
      createdBy: owners[0] || '',
      createdAt: stamp,
      updatedAt: stamp,
    }
    after[SPACE_COLLECTION].push(space)
    changes.createdSpace = true
    if (!options.anniversaryDate) warnings.push('没有传 --anniversary，空间的纪念日会留空；首页会隐藏纪念日模块。')
    const others = after[SPACE_COLLECTION].filter(row => row && row._id !== spaceId)
    if (others.length) warnings.push(`导出里已经有 ${others.length} 个别的空间，本次不会改动它们。`)
  }

  // ---- 2. 两名成员 ----
  const userRows = after[USER_COLLECTION]
  if (userRows.length !== 2) {
    warnings.push(`UserList 里是 ${userRows.length} 条记录，不是 2 条。空间按两人设计，请确认导出是否完整。`)
  }
  userRows.forEach((row, index) => {
    if (!row || typeof row !== 'object') return
    if (row.spaceId && row.spaceId !== spaceId) {
      changes.foreign.push({ collection: USER_COLLECTION, _id: row._id, spaceId: row.spaceId })
      return
    }
    const alreadyActive = row.spaceId === spaceId && row.memberStatus === 'active'
    if (alreadyActive && typeof row.displayName === 'string' && row.displayName.trim()) {
      changes.alreadyScoped += 1
      return
    }
    row.spaceId = spaceId
    row.memberStatus = 'active'
    if (typeof row.displayName !== 'string' || !row.displayName.trim()) {
      row.displayName = `成员${index + 1}`
      warnings.push(`UserList 里有记录没有昵称，先填成「成员${index + 1}」，可在小程序里改。`)
    }
    changes.users += 1
    changes.byCollection[USER_COLLECTION] = (changes.byCollection[USER_COLLECTION] || 0) + 1
  })

  // ---- 3. 业务记录补 spaceId ----
  for (const name of SCOPED_COLLECTIONS) {
    for (const row of after[name]) {
      if (!row || typeof row !== 'object') continue
      if (row.spaceId && row.spaceId !== spaceId) {
        changes.foreign.push({ collection: name, _id: row._id, spaceId: row.spaceId })
        continue
      }
      if (row.spaceId === spaceId) {
        changes.alreadyScoped += 1
        continue
      }
      row.spaceId = spaceId
      changes.records += 1
      changes.byCollection[name] = (changes.byCollection[name] || 0) + 1
    }
  }

  // ---- 4. 旧邀请：新代码按 spaceId 查，没有 spaceId 的旧邀请自然失效 ----
  const orphanInvites = after[INVITE_COLLECTION].filter(row => row && !row.spaceId).length
  if (orphanInvites) {
    warnings.push(`有 ${orphanInvites} 条旧邀请没有 spaceId。新代码不会读到它们，保持原样不动（不删）。`)
  }

  // ---- 5. 私人课表：从本机备份补进空间 ----
  const scheduleRows = normalizeSchedule(options.schedule, options.scheduleOwners, options.term, warnings)
  if (scheduleRows.length) {
    space.featureFlags = { ...(space.featureFlags || {}), schedule: true }
  }
  const existingScheduleOwners = new Set(
    after[SCHEDULE_COLLECTION].filter(row => row && row.spaceId === spaceId).map(row => row._openid),
  )
  for (const row of scheduleRows) {
    if (existingScheduleOwners.has(row._openid)) {
      changes.alreadyScoped += 1
      continue
    }
    after[SCHEDULE_COLLECTION].push({ ...row, spaceId, date: stamp })
    existingScheduleOwners.add(row._openid)
    changes.createdSchedule += 1
  }

  // ---- 6. 照片：默认只出台账，不动数据 ----
  const photos = photoUploads(options.photoDir, spaceId)
  if (options.photosAsPosts) {
    const owner = options.photoOwner
    const prefix = options.fileIdPrefix
    if (!owner) throw new Error('--photos-as-posts 需要同时提供 --photo-owner')
    if (!prefix) throw new Error('--photos-as-posts 需要同时提供 --file-id-prefix')
    for (const photo of photos) {
      const fileId = `${prefix}/${photo.cloudPath}`
      const exists = after.MemoryPostList.some(row => row && row.imageFileId === fileId)
      if (exists) {
        changes.alreadyScoped += 1
        continue
      }
      after.MemoryPostList.push({
        _openid: owner,
        spaceId,
        content: `从旧版迁过来的照片：${path.basename(photo.cloudPath)}`,
        imageFileId: fileId,
        likedBy: [],
        comments: [],
        date: stamp,
      })
      changes.records += 1
      changes.byCollection.MemoryPostList = (changes.byCollection.MemoryPostList || 0) + 1
    }
  }

  // ---- 7. 旧图片回填受信任台账 ----
  // 旧版 fileID 没有 couples/<spaceId>/ 前缀，运行时不能仅凭客户端输入信任。
  // 迁移脚本依据“已导出、已确认属于本空间”的业务记录生成只读台账，
  // 注销时只允许这里标记的 legacyTrusted fileID 绕过新路径前缀检查。
  for (const collection of ['MenuList', 'MemoryPostList']) {
    for (const row of after[collection]) {
      const fileId = row && typeof row.imageFileId === 'string' ? row.imageFileId.trim() : ''
      if (!fileId.startsWith('cloud://') || row.spaceId !== spaceId) continue
      if (after[FILE_COLLECTION].some(item => item && item.spaceId === spaceId && item.fileId === fileId)) continue
      const digest = crypto.createHash('sha256').update(`${spaceId}:${fileId}`).digest('hex')
      after[FILE_COLLECTION].push({
        _id: `legacy-file-${digest}`,
        spaceId,
        fileId,
        legacyTrusted: true,
        sourceCollection: collection,
        sourceRecordId: row._id || '',
        createdAt: stamp,
      })
      changes.createdFileLedger += 1
      changes.byCollection[FILE_COLLECTION] = (changes.byCollection[FILE_COLLECTION] || 0) + 1
    }
  }

  const stats = statsOf(after)
  stats.localPhotos = photos.length
  const before = statsOf(collections)
  before.localPhotos = photos.length

  if (changes.foreign.length) {
    warnings.push(`有 ${changes.foreign.length} 条记录属于别的空间，已原样跳过（见报告 foreign）。`)
  }

  return { spaceId, space: clone(space), collections: after, changes, warnings, photos, statsBefore: before, statsAfter: stats }
}

// 课表支持两种输入：
//   · 已按目标形状写好：[{ openid, term, days }]
//   · 旧版按角色分组的对象：{ memberA: { 1: [...] }, memberB: {...} }，配 --schedule-owners
function normalizeSchedule(input, owners, term, warnings) {
  if (!input) return []
  if (Array.isArray(input)) {
    return input.map(row => ({
      _openid: row && row.openid,
      ownerKey: (row && row.ownerKey) || '',
      term: (row && row.term) || term || '',
      days: (row && row.days) || {},
    })).filter(row => {
      if (typeof row._openid === 'string' && row._openid) return true
      warnings.push('课表里有一条没有 openid，已跳过。')
      return false
    })
  }
  const map = owners && typeof owners === 'object' ? owners : {}
  const rows = []
  for (const [role, days] of Object.entries(input)) {
    const openid = map[role]
    if (typeof openid !== 'string' || !openid) {
      warnings.push(`课表里的角色「${role}」没有配 openid，已跳过；用 --schedule-owners ${role}=<openid> 指定。`)
      continue
    }
    rows.push({ _openid: openid, ownerKey: openid, term: term || '', days: days && typeof days === 'object' ? days : {} })
  }
  return rows
}

// ---------------------------------------------------------------- 报告

const METRIC_LABELS = [
  ['totalRecords', '记录总数'],
  ['totalCredit', '积分总值'],
  ['pendingMissions', '未完成任务'],
  ['completedMissions', '已完成任务'],
  ['storageItems', '仓库物品'],
  ['storageUnused', '待使用物品'],
  ['recordPhotos', '记录里的照片'],
  ['localPhotos', '待上传的本地照片'],
  ['scheduleOwners', '课表人数'],
  ['scheduleEntries', '课表条目'],
]

function metricTable(before, after) {
  const rows = METRIC_LABELS.map(([key, label]) => [label, String(before[key]), String(after[key]), before[key] === after[key] ? '一致' : '有变化'])
  for (const name of MANAGED_COLLECTIONS) {
    const left = before.recordCounts[name]
    const right = after.recordCounts[name]
    rows.push([`${name} 记录数`, String(left), String(right), left === right ? '一致' : `+${right - left}`])
  }
  return rows
}

function renderReport(plan, options = {}) {
  const lines = []
  lines.push('# 迁移报告')
  lines.push('')
  lines.push(`- 目标空间：\`${plan.spaceId}\`（${plan.space.name}）`)
  lines.push(`- 空间记录：${plan.changes.createdSpace ? '本次新建' : '已存在，原样保留'}`)
  lines.push(`- 预览模式：${options.dryRun ? '是（未写任何文件）' : '否'}`)
  lines.push('')
  lines.push('## 变更计数')
  lines.push('')
  lines.push('| 项目 | 数量 |')
  lines.push('|---|---|')
  lines.push(`| 新建空间 | ${plan.changes.createdSpace ? 1 : 0} |`)
  lines.push(`| 补 spaceId 的用户 | ${plan.changes.users} |`)
  lines.push(`| 补 spaceId 的业务记录 | ${plan.changes.records} |`)
  lines.push(`| 新增课表 | ${plan.changes.createdSchedule} |`)
  lines.push(`| 本来就已就位（跳过） | ${plan.changes.alreadyScoped} |`)
  lines.push(`| 属于别的空间（跳过） | ${plan.changes.foreign.length} |`)
  lines.push('')
  lines.push('## 迁移前后比对')
  lines.push('')
  lines.push('| 口径 | 迁移前 | 迁移后 | 结论 |')
  lines.push('|---|---|---|---|')
  for (const row of metricTable(plan.statsBefore, plan.statsAfter)) lines.push(`| ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} |`)
  lines.push('')
  if (plan.photos.length) {
    lines.push('## 照片上传清单')
    lines.push('')
    lines.push('下一步：在云开发控制台「存储」里按下面的路径上传这些文件（保留原文件名）。')
    lines.push('')
    lines.push('| 本地文件 | 云端路径 |')
    lines.push('|---|---|')
    for (const photo of plan.photos) lines.push(`| ${path.basename(photo.local)} | ${photo.cloudPath} |`)
    lines.push('')
  }
  if (plan.warnings.length) {
    lines.push('## 需要留意')
    lines.push('')
    for (const warning of plan.warnings) lines.push(`- ${warning}`)
    lines.push('')
  }
  lines.push('## 导入顺序')
  lines.push('')
  lines.push('在云开发控制台按这个顺序导入本目录下的 JSON（每导入一个集合前确认它已存在）：')
  lines.push('')
  MANAGED_COLLECTIONS.forEach((name, index) => lines.push(`${index + 1}. ${name}.json`))
  lines.push('')
  lines.push('导入完成后重新跑一次本脚本（`--input` 指向本次输出目录），如果「变更计数」全是 0，说明迁移是幂等的、没有重复写入。')
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const options = { dryRun: false, confirmBackup: false, photosAsPosts: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const next = () => {
      index += 1
      if (index >= argv.length) throw new Error(`参数 ${token} 缺少取值`)
      return argv[index]
    }
    if (token === '--input') options.input = next()
    else if (token === '--output') options.output = next()
    else if (token === '--space-id') options.spaceId = next()
    else if (token === '--space-name') options.spaceName = next()
    else if (token === '--anniversary') options.anniversaryDate = next()
    else if (token === '--schedule') options.scheduleFile = next()
    else if (token === '--schedule-owners') options.scheduleOwnersRaw = next()
    else if (token === '--term') options.term = next()
    else if (token === '--no-schedule') options.noSchedule = true
    else if (token === '--photos-dir') options.photoDir = next()
    else if (token === '--photo-owner') options.photoOwner = next()
    else if (token === '--file-id-prefix') options.fileIdPrefix = next()
    else if (token === '--photos-as-posts') options.photosAsPosts = true
    else if (token === '--dry-run') options.dryRun = true
    else if (token === '--confirm-backup') options.confirmBackup = true
    else if (token === '--help' || token === '-h') options.help = true
    else throw new Error(`不认识的参数：${token}`)
  }
  return options
}

function parseScheduleOwners(raw) {
  const owners = {}
  if (!raw) return owners
  for (const part of String(raw).split(',')) {
    const [role, openid] = part.split('=')
    if (role && openid) owners[role.trim()] = openid.trim()
  }
  return owners
}

const USAGE = `用法：
  node scripts/migrate-space.cjs --input <导出目录> --space-id <空间编号> [选项]

必填：
  --input <目录>        云开发控制台导出的集合目录（只读，同时充当备份）
  --space-id <编号>     给两位旧用户新建的空间编号，例如 space-legacy

常用：
  --output <目录>       迁移结果写到哪（默认 <input>/../after，不能与 input 相同）
  --space-name <名称>   空间名称，默认「我们的空间」
  --anniversary <日期>  纪念日，YYYY-MM-DD；不传则留空
  --dry-run             只打报告，不写文件
  --confirm-backup      确认导出目录是完整备份；写文件前必须显式给出

可选：
  --schedule <文件>           本机旧课表；默认尝试 .local/legacy-schedule.json
  --no-schedule               不迁移课表（默认会尝试读上面那个文件）
  --schedule-owners memberA=<openid>,memberB=<openid>
  --term <学期>               课表学期，默认 2026-2027-1
  --photos-dir <目录>         私人照片备份目录，默认 .local/private-photos-backup/memories
  --photos-as-posts           把每张照片变成空间里的一条共同记录
  --photo-owner <openid>      配 --photos-as-posts：记录挂在谁名下
  --file-id-prefix <前缀>     配 --photos-as-posts：cloud://<环境>.<存储桶>
`

function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  if (!options.input) throw new Error('缺少 --input。\n\n' + USAGE)
  if (!options.spaceId) throw new Error('缺少 --space-id。\n\n' + USAGE)

  const input = path.resolve(options.input)
  if (!fs.existsSync(input) || !fs.statSync(input).isDirectory()) throw new Error(`导出目录不存在：${input}`)

  const output = path.resolve(options.output || path.join(input, '..', 'after'))
  if (output === input) throw new Error('输出目录不能和导出目录相同：导出目录是备份，只读。')
  if (!options.dryRun && !options.confirmBackup) {
    throw new Error('写文件前请先确认导出目录已经是完整备份，并加上 --confirm-backup。想先看结果就用 --dry-run。')
  }

  const { collections, found } = readCollections(input)
  if (!found.length) throw new Error(`导出目录里没找到任何集合文件（如 UserList.json）：${input}`)
  console.log(`读到 ${found.length} 个集合：${found.join('、')}`)

  const missing = MANAGED_COLLECTIONS.filter(name => !found.includes(name))
  if (missing.length) console.log(`导出里没有这些集合，按空处理：${missing.join('、')}`)

  const scheduleFile = options.scheduleFile || (!options.noSchedule
    ? path.join(path.resolve(__dirname, '..'), '.local', 'legacy-schedule.json')
    : '')
  let schedule = null
  if (scheduleFile && fs.existsSync(scheduleFile)) {
    schedule = JSON.parse(fs.readFileSync(scheduleFile, 'utf8'))
    console.log(`读到本机旧课表：${path.basename(scheduleFile)}`)
  } else if (options.scheduleFile) {
    throw new Error(`指定的课表文件不存在：${scheduleFile}`)
  }

  const photoDir = path.resolve(options.photosDir || path.join(path.resolve(__dirname, '..'), '.local', 'private-photos-backup', 'memories'))
  const owners = parseScheduleOwners(options.scheduleOwnersRaw)

  const plan = planMigration(collections, {
    spaceId: options.spaceId,
    spaceName: options.spaceName,
    anniversaryDate: options.anniversaryDate,
    schedule,
    scheduleOwners: owners,
    term: options.term || '2026-2027-1',
    photoDir,
    photosAsPosts: options.photosAsPosts,
    photoOwner: options.photoOwner,
    fileIdPrefix: options.fileIdPrefix,
  })

  const report = renderReport(plan, { dryRun: options.dryRun })
  console.log('')
  console.log(report)

  if (options.dryRun) {
    console.log('预览模式：没有写任何文件。确认无误后去掉 --dry-run，并加上 --confirm-backup。')
    return 0
  }

  fs.mkdirSync(output, { recursive: true })
  for (const name of MANAGED_COLLECTIONS) {
    fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(plan.collections[name], null, 2) + '\n', 'utf8')
  }
  fs.writeFileSync(path.join(output, 'report.md'), report + '\n', 'utf8')
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({
    spaceId: plan.spaceId,
    changes: plan.changes,
    warnings: plan.warnings,
    statsBefore: plan.statsBefore,
    statsAfter: plan.statsAfter,
    photos: plan.photos.map(photo => photo.cloudPath),
  }, null, 2) + '\n', 'utf8')

  console.log('')
  console.log(`已写出到 ${output}：${MANAGED_COLLECTIONS.length} 个集合文件 + report.md + report.json`)
  console.log('导出目录（备份）请保留到双手机验收通过之后再清理。')
  return 0
}

module.exports = {
  MANAGED_COLLECTIONS,
  SCOPED_COLLECTIONS,
  countScheduleEntries,
  parseCollectionText,
  planMigration,
  readCollections,
  renderReport,
  statsOf,
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error('迁移脚本出错：' + (error && error.message))
    process.exitCode = 1
  }
}
