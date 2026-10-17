function unwrapDocument(result) {
  if (!result) return null
  if (Array.isArray(result.data)) return result.data[0] || null
  return result.data || null
}

function isMissingDocumentError(error) {
  const code = String(error && (error.errCode || error.code) || '')
  const message = String(error && (error.errMsg || error.message) || error || '')
  return code.includes('DOCUMENT_NOT_FOUND') || /document with _id .* does not exist/i.test(message)
}

function createRepository(database, command = database.command) {
  return {
    async findOne(name, query) {
      const result = await database.collection(name).where(query).limit(1).get()
      return result.data[0] || null
    },
    async findMany(name, query = {}) {
      if (Object.prototype.hasOwnProperty.call(query, '_id')) {
        throw new Error('findMany does not support an _id query because pagination uses _id cursor')
      }
      const collection = database.collection(name)
      const documents = []
      const pageSize = 100
      let lastId

      while (true) {
        const pageConditions = lastId === undefined ? query : { ...query, _id: command.gt(lastId) }
        const pageQuery = Object.keys(pageConditions).length ? collection.where(pageConditions) : collection
        const result = await pageQuery.orderBy('_id', 'asc').limit(pageSize).get()
        const page = result.data || []
        documents.push(...page)
        if (page.length < pageSize) break
        lastId = page[page.length - 1]._id
      }

      return documents
    },
    async getById(name, id) {
      try {
        return unwrapDocument(await database.collection(name).doc(id).get())
      } catch (error) {
        if (isMissingDocumentError(error)) return null
        throw error
      }
    },
    async add(name, data) {
      const result = await database.collection(name).add({ data })
      return { ...data, _id: result._id || result.id }
    },
    async setById(name, id, data) {
      await database.collection(name).doc(id).set({ data })
      return { ...data, _id: id }
    },
    async updateById(name, id, patch, options = {}) {
      const data = { ...patch }
      for (const field of options.replaceObjectFields || []) {
        if (Object.prototype.hasOwnProperty.call(data, field)) data[field] = command.set(data[field])
      }
      await database.collection(name).doc(id).update({ data })
      return { ...patch, _id: id }
    },
    async removeById(name, id) {
      await database.collection(name).doc(id).remove()
    },
    async runTransaction(callback) {
      return database.runTransaction(transaction => callback(createRepository(transaction, command)))
    },
  }
}

module.exports = { createRepository }
