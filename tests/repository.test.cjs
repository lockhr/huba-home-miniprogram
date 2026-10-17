const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createRepository } = require('../cloudfunctions/api/repository')

function createDatabase(initialDocuments, { beforeGet } = {}) {
  const documents = [...initialDocuments]
  const calls = []
  let getCount = 0
  const command = { gt(value) { return { $gt: value } } }
  return {
    calls,
    command,
    collection(name) {
      assert.equal(name, 'MemoryPostList')
      return createQuery({ query: {}, order: null, limit: null })
    },
  }

  function createQuery(state) {
    return {
      where(query) {
        calls.push({ method: 'where', query })
        return createQuery({ ...state, query: { ...state.query, ...query } })
      },
      orderBy(field, direction) {
        calls.push({ method: 'orderBy', field, direction })
        return createQuery({ ...state, order: { field, direction } })
      },
      limit(size) {
        calls.push({ method: 'limit', size })
        return createQuery({ ...state, limit: size })
      },
      async get() {
        beforeGet?.({ getCount, documents })
        getCount += 1
        let filtered = documents.filter(document => Object.entries(state.query).every(([key, value]) => {
          if (value && typeof value === 'object' && '$gt' in value) return document[key] > value.$gt
          return document[key] === value
        }))
        if (state.order) {
          const { field, direction } = state.order
          filtered = [...filtered].sort((a, b) => direction === 'asc' ? String(a[field]).localeCompare(String(b[field])) : String(b[field]).localeCompare(String(a[field])))
        }
        return { data: filtered.slice(0, state.limit || filtered.length) }
      },
    }
  }
}

function posts(count) {
  return Array.from({ length: count }, (_, index) => ({ _id: `post-${String(index).padStart(3, '0')}`, group: 'all' }))
}

test('findMany reads 205 documents in ordered cursor pages of at most 100', async () => {
  const database = createDatabase(posts(205))
  const repository = createRepository(database)
  const result = await repository.findMany('MemoryPostList')
  assert.equal(result.length, 205)
  assert.deepEqual(database.calls.filter(call => call.method === 'orderBy').map(call => call.direction), ['asc', 'asc', 'asc'])
  assert.equal(database.calls.some(call => call.method === 'skip'), false)
  assert.deepEqual(database.calls.filter(call => call.method === 'limit').map(call => call.size), [100, 100, 100])
})

test('findMany keeps every document when an earlier page record is deleted between reads', async () => {
  const database = createDatabase(posts(205), { beforeGet({ getCount, documents }) { if (getCount === 1) documents.shift() } })
  const result = await createRepository(database).findMany('MemoryPostList')
  assert.equal(result.length, 205)
  assert.deepEqual(result.map(document => document._id), posts(205).map(document => document._id))
})

test('findMany preserves where conditions while reading cursor pages', async () => {
  const database = createDatabase(posts(205).map((document, index) => ({ ...document, group: index % 2 ? 'other' : 'target' })))
  const result = await createRepository(database).findMany('MemoryPostList', { group: 'target' })
  assert.equal(result.length, 103)
  assert.ok(database.calls.filter(call => call.method === 'where').every(call => call.query.group === 'target' || call.query._id))
  assert.equal(database.calls.some(call => call.method === 'skip'), false)
})

test('findMany handles zero and exactly one full page', async () => {
  const emptyDatabase = createDatabase([])
  assert.deepEqual(await createRepository(emptyDatabase).findMany('MemoryPostList'), [])
  assert.deepEqual(emptyDatabase.calls.filter(call => call.method === 'limit').map(call => call.size), [100])
  const fullDatabase = createDatabase(posts(100))
  assert.equal((await createRepository(fullDatabase).findMany('MemoryPostList')).length, 100)
  assert.deepEqual(fullDatabase.calls.filter(call => call.method === 'limit').map(call => call.size), [100, 100])
})

test('findMany rejects an _id query instead of silently replacing it', async () => {
  const repository = createRepository(createDatabase(posts(1)))
  await assert.rejects(() => repository.findMany('MemoryPostList', { _id: 'post-001' }), /_id query/i)
})

test('getById treats the cloud SDK missing-document error as an empty result', async () => {
  const database = {
    command: {},
    collection() {
      return {
        doc() {
          return {
            async get() {
              throw new Error('document with _id wx-new-user does not exist')
            },
          }
        },
      }
    },
  }

  const result = await createRepository(database).getById('UserList', 'wx-new-user')

  assert.equal(result, null)
})

test('updateById replaces an object field when the stored field is null', async () => {
  const document = { _id: 'space-1', status: 'active', deletion: null }
  const database = {
    command: { set(value) { return { __setValue: value } } },
    collection() {
      return {
        doc() {
          return {
            async update({ data }) {
              if (data.deletion && !Object.prototype.hasOwnProperty.call(data.deletion, '__setValue')) {
                throw new Error("Cannot create field 'approvedBy' in element {deletion: null}")
              }
              Object.assign(document, data, { deletion: data.deletion.__setValue })
            },
          }
        },
      }
    },
  }
  const deletion = { phase: 'cooldown', approvedBy: ['member-a'] }

  await createRepository(database).updateById('CoupleSpaceList', 'space-1', {
    status: 'deleting', deletion,
  }, { replaceObjectFields: ['deletion'] })

  assert.equal(document.status, 'deleting')
  assert.deepEqual(document.deletion, deletion)
})

test('updateById explicitly replaces an object field with null', async () => {
  const document = { _id: 'space-1', status: 'deleting', deletion: { phase: 'cooldown' } }
  const database = {
    command: { set(value) { return { __setValue: value } } },
    collection() {
      return {
        doc() {
          return {
            async update({ data }) {
              if (!data.deletion || !Object.prototype.hasOwnProperty.call(data.deletion, '__setValue')) {
                throw new Error('object fields must be replaced with command.set')
              }
              Object.assign(document, data, { deletion: data.deletion.__setValue })
            },
          }
        },
      }
    },
  }

  await createRepository(database).updateById('CoupleSpaceList', 'space-1', {
    status: 'active', deletion: null,
  }, { replaceObjectFields: ['deletion'] })

  assert.equal(document.status, 'active')
  assert.equal(document.deletion, null)
})
