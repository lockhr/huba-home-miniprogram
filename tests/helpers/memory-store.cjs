// M2 新增测试共用的内存数据库。行为对齐 cloudfunctions/api/repository.js
// 暴露的接口：findOne / findMany / getById / add / setById / updateById / removeById / runTransaction。
function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function matches(item, query) {
  return Object.entries(query || {}).every(([key, value]) => item[key] === value)
}

class MemoryStore {
  constructor(seed = {}) {
    this.data = clone(seed)
    this.nextId = 1
    this.tail = Promise.resolve()
  }

  collection(name) {
    if (!this.data[name]) this.data[name] = []
    return this.data[name]
  }

  async findOne(name, query) {
    return clone(this.collection(name).find(item => matches(item, query)) || null)
  }

  async findMany(name, query = {}) {
    return clone(this.collection(name).filter(item => matches(item, query)))
  }

  async getById(name, id) {
    return clone(this.collection(name).find(item => item._id === id) || null)
  }

  async add(name, data) {
    const item = { ...clone(data), _id: `${name}-${this.nextId++}` }
    this.collection(name).push(item)
    return clone(item)
  }

  async setById(name, id, data) {
    const list = this.collection(name)
    const index = list.findIndex(item => item._id === id)
    const item = { ...clone(data), _id: id }
    if (index >= 0) list[index] = item
    else list.push(item)
    return clone(item)
  }

  async updateById(name, id, patch) {
    const item = this.collection(name).find(value => value._id === id)
    if (!item) throw new Error('missing document')
    Object.assign(item, clone(patch))
    return clone(item)
  }

  async removeById(name, id) {
    const list = this.collection(name)
    const index = list.findIndex(item => item._id === id)
    if (index < 0) throw new Error('missing document')
    list.splice(index, 1)
  }

  // 真实云数据库会把同一空间的并发写串行化。这里用队列模拟同样的可见性，
  // 否则「两个人同时用同一条邀请」会被非事务的时序假象蒙混过关。
  async runTransaction(callback) {
    const previous = this.tail
    let release
    this.tail = new Promise(resolve => { release = resolve })
    await previous
    try {
      const draft = new MemoryStore(this.data)
      draft.nextId = this.nextId
      const result = await callback(draft)
      this.data = draft.data
      this.nextId = draft.nextId
      return result
    } finally {
      release()
    }
  }
}

function isoAt(offsetMs = 0) {
  return new Date(Date.parse('2026-09-16T04:00:00.000Z') + offsetMs).toISOString()
}

// 一个「已经配对好」的空间：阿禾与小柚。
function pairedSpace() {
  return {
    CoupleSpaceList: [
      { _id: 'space-1', name: '测试空间', anniversaryDate: '', status: 'active', featureFlags: {}, createdBy: 'a', createdAt: isoAt(), updatedAt: isoAt() },
    ],
    PairInviteList: [],
    UserList: [
      { _id: 'user-a', _openid: 'a', credit: 10, spaceId: 'space-1', memberStatus: 'active', displayName: '阿禾', avatarKey: 'cat' },
      { _id: 'user-b', _openid: 'b', credit: 5, spaceId: 'space-1', memberStatus: 'active', displayName: '小柚', avatarKey: 'rabbit' },
    ],
    MissionList: [],
    MarketList: [],
    StorageList: [],
    HouseRuleList: [],
    MenuList: [],
    DinnerOrderList: [],
    MemoryPostList: [],
    WishList: [],
  }
}

// 一个「还没配对」的新账号，连 UserList 记录都还没有。
function emptyWorld() {
  return {
    CoupleSpaceList: [],
    PairInviteList: [],
    UserList: [],
    MissionList: [],
    MarketList: [],
    StorageList: [],
    HouseRuleList: [],
    MenuList: [],
    DinnerOrderList: [],
    MemoryPostList: [],
    WishList: [],
  }
}

module.exports = { MemoryStore, clone, emptyWorld, isoAt, pairedSpace }
