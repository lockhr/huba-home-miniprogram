// Application-side credits, reconciled when WeChat reports no subscription.
function creditsOf(user) {
  return user && Number.isSafeInteger(user.reminderCredits) && user.reminderCredits >= 0
    ? user.reminderCredits : (user && user.reminderReady === true ? 1 : 0)
}

async function changeUser(store, user, change) {
  const update = async tx => {
    const fresh = typeof store.runTransaction === 'function'
      ? await tx.getById('UserList', user._id) : await tx.findOne('UserList', { _openid: user._openid })
    if (!fresh) return null
    // 空间一致性：提醒账本只在同一个空间里的成员之间结算。
    if (user.spaceId && fresh.spaceId !== user.spaceId) return null
    const patch = change(fresh)
    if (!patch) return null
    await tx.updateById('UserList', user._id, patch)
    return { ...fresh, ...patch }
  }
  return typeof store.runTransaction === 'function' ? store.runTransaction(update) : update(store)
}

async function grantReminder(store, user, grantId, at) {
  return changeUser(store, user, fresh => {
    const ids = Array.isArray(fresh.reminderGrantIds) ? fresh.reminderGrantIds : []
    if (grantId && ids.includes(grantId)) return { reminderCredits: creditsOf(fresh), reminderReady: creditsOf(fresh) > 0 }
    return {
      reminderCredits: creditsOf(fresh) + 1,
      reminderReady: true,
      reminderGrantedAt: at,
      reminderGrantVersion: (fresh.reminderGrantVersion || 0) + 1,
      reminderGrantIds: grantId ? [...ids, grantId].slice(-64) : ids,
    }
  })
}

async function reserveReminder(store, user, at) {
  return changeUser(store, user, fresh => {
    const count = creditsOf(fresh)
    if (!count) return null
    return { reminderCredits: count - 1, reminderReady: count > 1, reminderConsumedAt: at }
  })
}

async function releaseReminder(store, reservation, noSubscription) {
  return changeUser(store, reservation, fresh => {
    const count = noSubscription
      ? Math.min(creditsOf(fresh), Math.max(0, (fresh.reminderGrantVersion || 0) - (reservation.reminderGrantVersion || 0)))
      : creditsOf(fresh) + 1
    return { reminderCredits: count, reminderReady: count > 0 }
  })
}

module.exports = { creditsOf, grantReminder, reserveReminder, releaseReminder }
