const cloud = require('wx-server-sdk')
const { createService, BusinessError } = require('./service')
const { costGuardFrom, errorPayload, monitorPayload } = require('./shared.js')
const { askXiaoBa } = require('./ai-client')
const { resolveSharedMedia, shouldResolveSharedMedia } = require('./media-urls')
const { notificationTimeoutMs, sendPartnerNotificationSafely } = require('./notifications')
const { createRepository } = require('./repository')
const { createCloudFileCleanup } = require('./file-cleanup')
const { createImageModerator, createTextModerator } = require('./content-safety')
const { createScheduleOcr } = require('./schedule-ocr')
const { runtimeCapabilitiesFrom } = require('./runtime-capabilities')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const COLLECTIONS_BY_ACTION = {
  // 配对与空间生命周期：空间与邀请集合是新用户第一次调用就可能需要的，
  // 因此必须在 action 白名单里提前创建。
  getBootstrap: ['UserList', 'CoupleSpaceList'],
  updateProfile: ['UserList'],
  deleteAccount: ['UserList'],
  createSpace: ['CoupleSpaceList', 'PairInviteList', 'UserList'],
  getInvite: ['PairInviteList', 'CoupleSpaceList', 'UserList'],
  joinSpace: ['PairInviteList', 'CoupleSpaceList', 'UserList'],
  regenerateInvite: ['PairInviteList', 'CoupleSpaceList', 'UserList'],
  updateSpace: ['CoupleSpaceList', 'UserList'],
  setSpaceAppearance: ['CoupleSpaceList', 'UserList', 'SpaceFileList'],
  setMyAvatarImage: ['CoupleSpaceList', 'UserList', 'SpaceFileList'],
  unpair: ['CoupleSpaceList', 'UserList', 'PairInviteList'],
  requestSpaceDeletion: ['CoupleSpaceList', 'UserList'],
  approveSpaceDeletion: ['CoupleSpaceList', 'UserList'],
  rejectSpaceDeletion: ['CoupleSpaceList', 'UserList'],
  cancelSpaceDeletion: ['CoupleSpaceList', 'UserList'],
  restoreLegacyDeletingSpace: ['CoupleSpaceList', 'UserList'],
  startSpacePurge: ['CoupleSpaceList', 'UserList'],
  continueSpacePurge: ['CoupleSpaceList', 'UserList', 'SpaceFileList', 'PairInviteList', 'ScheduleList', 'MissionList', 'MarketList', 'StorageList', 'HouseRuleList', 'MenuList', 'DinnerOrderList', 'MemoryPostList', 'WishList'],
  trackSpaceFile: ['UserList', 'CoupleSpaceList', 'SpaceFileList'],
  getUsers: ['UserList'],
  getSchedule: ['ScheduleList', 'UserList'],
  recognizeScheduleImage: ['UserList', 'CoupleSpaceList', 'SpaceFileList'],
  replaceMySchedule: ['ScheduleList', 'UserList', 'CoupleSpaceList'],
  getSession: ['UserList'],
  getHouseRules: ['HouseRuleList'],
  createHouseRule: ['HouseRuleList'],
  deleteHouseRule: ['HouseRuleList'],
  getDinnerData: ['MenuList', 'DinnerOrderList'],
  createDish: ['MenuList', 'SpaceFileList'],
  toggleDish: ['MenuList'],
  deleteDish: ['MenuList', 'SpaceFileList'],
  completeDinnerOrder: ['MenuList', 'DinnerOrderList'],
  getRecords: ['MemoryPostList', 'WishList'],
  createMemoryPost: ['MemoryPostList', 'SpaceFileList'],
  toggleMemoryLike: ['MemoryPostList', 'UserList'],
  addMemoryComment: ['MemoryPostList', 'UserList'],
  deleteMemoryPost: ['MemoryPostList', 'SpaceFileList'],
  createWish: ['WishList', 'SpaceFileList'],
  toggleWish: ['WishList'],
  deleteWish: ['WishList', 'SpaceFileList'],
  askXiaoBa: ['UserList', 'CoupleSpaceList', 'MissionList', 'MarketList', 'StorageList', 'HouseRuleList', 'MenuList', 'DinnerOrderList', 'MemoryPostList', 'WishList'],
}
const collectionReady = new Map()

function includesAny(value, parts) {
  const text = String(value || '').toLowerCase()
  return parts.some(part => text.includes(part))
}

async function ensureCollection(name) {
  if (!collectionReady.has(name)) {
    const promise = (async () => {
      try {
        await db.collection(name).limit(1).get()
      } catch (error) {
        const code = error && (error.errCode || error.code)
        const message = error && (error.errMsg || error.message)
        const missing = includesAny(code, ['-502005', 'collection_not_exist']) || includesAny(message, ['collection not exist', '集合不存在'])
        if (!missing) throw error
        try {
          await db.createCollection(name)
        } catch (createError) {
          const createCode = createError && (createError.errCode || createError.code)
          const createMessage = createError && (createError.errMsg || createError.message)
          const alreadyExists = includesAny(createCode, ['already_exist', '-501001']) || includesAny(createMessage, ['already exist', '已存在'])
          if (!alreadyExists) throw createError
        }
      }
    })().catch(error => {
      collectionReady.delete(name)
      throw error
    })
    collectionReady.set(name, promise)
  }
  return collectionReady.get(name)
}

exports.main = async event => {
  const startedAt = Date.now()
  const action = (event && event.action) || 'unknown'
  // 这里存的是原始空间编号；写日志时才哈希，避免被哈希两次。
  let callerSpaceId = ''
  let status = 'ok'
  let code = ''
  try {
    const openid = cloud.getWXContext().OPENID
    const requiredCollections = COLLECTIONS_BY_ACTION[event && event.action] || []
    await Promise.all(requiredCollections.map(ensureCollection))
    const repository = createRepository(db)
    const moderateText = createTextModerator(options => cloud.openapi.security.msgSecCheck(options))
    const moderateImage = createImageModerator(
      options => cloud.downloadFile(options),
      options => cloud.openapi.security.imgSecCheck(options),
    )
    const service = createService(repository, () => db.serverDate(), askXiaoBa, {
      costGuard: costGuardFrom(process.env),
      capabilities: runtimeCapabilitiesFrom(process.env),
      onCaller: caller => { callerSpaceId = (caller && caller.spaceId) || '' },
      deleteFiles: createCloudFileCleanup(cloud),
      contentSafetyRequired: true,
      moderateText,
      moderateImage,
      recognizeScheduleImage: createScheduleOcr(cloud),
    })
    const input = { ...((event && event.data) || {}) }
    if (event && event.weRunData) input.weRunData = event.weRunData
    let data = await service.execute(event && event.action, input, openid)
    if (shouldResolveSharedMedia(event && event.action)) {
      data = await resolveSharedMedia(data, fileList => cloud.getTempFileURL({ fileList }))
    }
    await sendPartnerNotificationSafely({
      cloud,
      store: repository,
      openid,
      action: event && event.action,
      input,
      result: data,
    }, { timeoutMs: notificationTimeoutMs(Date.now() - startedAt) })
    return { ok: true, data }
  } catch (error) {
    code = error.code || 'SERVER_ERROR'
    status = 'error'
    if (!(error instanceof BusinessError)) {
      // 不记请求正文、AI 问题或照片地址，只留错误类型与栈，够定位就行。
      console.error(JSON.stringify(errorPayload({ action, spaceId: callerSpaceId, error, code })))
    }
    return {
      ok: false,
      error: code,
      message: error instanceof BusinessError
        ? error.message
        : '服务器暂时不可用，请稍后重试',
    }
  } finally {
    // 监控口径：接口、状态、错误码、耗时、空间匿名编号，仅此五项。
    console.log(JSON.stringify(monitorPayload({ action, status, code, ms: Date.now() - startedAt, spaceId: callerSpaceId })))
  }
}
