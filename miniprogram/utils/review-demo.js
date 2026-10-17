// 审核体验用的本地示例数据。只读，不连云端，里面不含任何真实姓名、真实 OpenID 或真实照片。
const REVIEW_SELF_OPENID = 'review-self'
const REVIEW_PARTNER_OPENID = 'review-partner'

const REVIEW_SELF = { openid: REVIEW_SELF_OPENID, displayName: '小禾', avatarKey: 'cat' }
const REVIEW_PARTNER = { openid: REVIEW_PARTNER_OPENID, displayName: '小柚', avatarKey: 'rabbit' }

const REVIEW_FEATURES = { schedule: false, dinner: true, records: true, xiaoba: true }

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function readOnlyError() {
  const error = new Error('审核体验为只读，仅用于浏览功能')
  error.code = 'REVIEW_READ_ONLY'
  return error
}

function createReviewDemo() {
  const now = '2026-09-13T12:00:00.000Z'
  const data = {
    UserList: [
      // 成员记录同时带 openid（页面用的成员身份）与 _openid（业务记录的作者字段），
      // 与云端 userView 返回的形状保持一致。
      { _id: 'review-user-self', openid: REVIEW_SELF_OPENID, _openid: REVIEW_SELF_OPENID, displayName: '小禾', avatarKey: 'cat', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true, credit: 88, mood: 'happy', canEditMood: true, steps: 6321, stepsDate: '2026-09-13', canSyncSteps: true, reminderReady: true, reminderCredits: 3 },
      { _id: 'review-user-partner', openid: REVIEW_PARTNER_OPENID, _openid: REVIEW_PARTNER_OPENID, displayName: '小柚', avatarKey: 'rabbit', profileComplete: true, identityNoticeRequired: false, onboardingComplete: true, credit: 66, mood: 'loved', canEditMood: false, steps: 4888, stepsDate: '2026-09-13', canSyncSteps: false, reminderReady: true, reminderCredits: 2 },
    ],
    MissionList: [
      { _id: 'review-mission-walk', _openid: REVIEW_PARTNER_OPENID, title: '晚饭后一起散步', desc: '在校园里慢慢走一圈', credit: 8, date: now, available: true, star: true },
      { _id: 'review-mission-breakfast', _openid: REVIEW_SELF_OPENID, title: '记得好好吃早餐', desc: '新的一天也要照顾好自己', credit: 5, date: '2026-09-12T00:30:00.000Z', available: false, star: false },
    ],
    MarketList: [
      { _id: 'review-market-milk-tea', _openid: REVIEW_SELF_OPENID, title: '一起喝杯奶茶', desc: '选两个人都喜欢的口味', credit: 12, date: now, available: true, star: true },
      { _id: 'review-market-photo', _openid: REVIEW_PARTNER_OPENID, title: '拍一组双人写真', desc: '把认真生活的样子留下来', credit: 20, date: '2026-09-11T10:00:00.000Z', available: false, star: false },
    ],
    StorageList: [
      { _id: 'review-storage-note', _openid: REVIEW_SELF_OPENID, title: '今天可以任性一次', desc: '来自对方的小小特权', credit: 7, date: now, available: true, star: true },
      { _id: 'review-storage-hug', _openid: REVIEW_SELF_OPENID, title: '一个认真拥抱', desc: '已经兑换并珍藏', credit: 5, date: '2026-09-10T12:00:00.000Z', available: false, star: false },
    ],
    HouseRuleList: [
      { _id: 'review-rule-listen', _openid: REVIEW_SELF_OPENID, content: '有分歧时，先把彼此的话认真听完。', date: now },
      { _id: 'review-rule-share', _openid: REVIEW_PARTNER_OPENID, content: '开心和委屈都可以第一时间告诉对方。', date: '2026-09-12T12:00:00.000Z' },
    ],
    MenuList: [
      { _id: 'review-dish-beef', _openid: REVIEW_SELF_OPENID, title: '番茄牛腩', desc: '酸甜暖胃，少辣', category: 'meat', minutes: 40, imageFileId: '', imageUrl: '', selected: false, date: now, canDelete: false },
      { _id: 'review-dish-soup', _openid: REVIEW_PARTNER_OPENID, title: '玉米排骨汤', desc: '慢慢炖一锅热汤', category: 'soup', minutes: 55, imageFileId: '', imageUrl: '', selected: true, date: '2026-09-12T10:00:00.000Z', canDelete: false },
      { _id: 'review-dish-rice', _openid: REVIEW_SELF_OPENID, title: '菠萝炒饭', desc: '今天想吃一点甜', category: 'staple', minutes: 25, imageFileId: '', imageUrl: '', selected: false, date: '2026-09-11T10:00:00.000Z', canDelete: false },
    ],
    DinnerOrderList: [
      { _id: 'review-order-one', _openid: REVIEW_PARTNER_OPENID, date: '2026-09-12T11:00:00.000Z', items: [{ dishId: 'review-dish-beef', title: '番茄牛腩', category: 'meat', imageFileId: '' }, { dishId: 'review-dish-rice', title: '菠萝炒饭', category: 'staple', imageFileId: '' }] },
    ],
    MemoryPostList: [
      { _id: 'review-post-coffee', _openid: REVIEW_PARTNER_OPENID, content: '周末的午后，一起喝咖啡吃甜点，普通的小事也很值得收藏。', imageFileId: '', imageUrl: '', date: now, liked: true, likeCount: 1, comments: [{ id: 'review-comment-one', _openid: REVIEW_SELF_OPENID, content: '下次还要一起去。', date: now }], canDelete: false },
      { _id: 'review-post-lake', _openid: REVIEW_SELF_OPENID, content: '傍晚沿着湖边散步，风吹过来的时候刚刚好。', imageFileId: '', imageUrl: '', date: '2026-09-12T09:00:00.000Z', liked: false, likeCount: 1, comments: [], canDelete: false },
    ],
    WishList: [
      { _id: 'review-wish-sunrise', _openid: REVIEW_SELF_OPENID, title: '一起去看海边日出', note: '看第一缕阳光落在海面上', icon: '🌅', date: now, completed: false, completedAt: null, completedBy: '', canDelete: false },
      { _id: 'review-wish-cake', _openid: REVIEW_PARTNER_OPENID, title: '学会做一份草莓蛋糕', note: '为对方准备甜甜的惊喜', icon: '🍰', date: '2026-09-11T08:00:00.000Z', completed: true, completedAt: '2026-09-12T08:00:00.000Z', completedBy: REVIEW_SELF_OPENID, canDelete: false },
    ],
    ScheduleList: [],
  }

  const bootstrap = {
    state: 'ready',
    user: data.UserList[0],
    partner: data.UserList[1],
    space: { _id: 'review-space', name: '体验空间', anniversaryDate: '', status: 'active' },
    features: { ...REVIEW_FEATURES },
  }

  function getById(list, id) {
    const items = data[list]
    if (!Array.isArray(items)) throw readOnlyError()
    const item = items.find(value => value._id === id)
    if (!item) throw readOnlyError()
    return clone(item)
  }

  return {
    identity: {
      currentUser: { ...REVIEW_SELF, credit: data.UserList[0].credit },
      partner: { ...REVIEW_PARTNER, credit: data.UserList[1].credit },
      space: bootstrap.space,
      features: { ...REVIEW_FEATURES },
      spaceState: 'ready',
    },
    readOnlyError,
    handle(action, input = {}) {
      if (action === 'getSession') return clone({ _openid: REVIEW_SELF_OPENID, openid: REVIEW_SELF_OPENID, credit: data.UserList[0].credit, reviewMode: true })
      if (action === 'getBootstrap') return clone(bootstrap)
      if (action === 'getUsers') return clone(data.UserList)
      if (action === 'getSchedule') return clone({ callerOpenid: REVIEW_SELF_OPENID, openid: REVIEW_SELF_OPENID, items: [] })
      if (action === 'getHouseRules') return clone({ callerOpenid: REVIEW_SELF_OPENID, items: data.HouseRuleList })
      if (action === 'getDinnerData') return clone({ dishes: data.MenuList, orders: data.DinnerOrderList })
      if (action === 'getRecords') return clone({ callerOpenid: REVIEW_SELF_OPENID, posts: data.MemoryPostList, wishes: data.WishList })
      if (action === 'getList' && ['MissionList', 'MarketList'].includes(input.list)) return clone(data[input.list])
      if (action === 'getStorage') return clone(data.StorageList)
      if (action === 'getById') return getById(input.list, input.id)
      throw readOnlyError()
    },
  }
}

module.exports = { REVIEW_PARTNER, REVIEW_SELF, createReviewDemo, readOnlyError }
