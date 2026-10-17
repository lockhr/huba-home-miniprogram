const { AI_CONSENT_KEY } = require('./ai-consent.js')

const ACTIVE_SCOPE_KEY = 'huba_xiaoba_active_scope_v3'
const LEGACY_HISTORY_KEY = 'huba_xiaoba_messages_v2'

function historyKey(bootstrap) {
  const user = bootstrap && bootstrap.user && bootstrap.user.openid
  const space = bootstrap && bootstrap.space && bootstrap.space._id
  const partner = bootstrap && bootstrap.partner && bootstrap.partner.openid
  if (![user, space, partner].every(value => typeof value === 'string' && value)) return ''
  return `huba_xiaoba_messages_v3:${encodeURIComponent(user)}:${encodeURIComponent(space)}:${encodeURIComponent(partner)}`
}

function clearXiaoBaSession(wxApi) {
  try {
    const active = wxApi.getStorageSync(ACTIVE_SCOPE_KEY)
    if (typeof active === 'string' && active.startsWith('huba_xiaoba_messages_v3:')) wxApi.removeStorageSync(active)
    wxApi.removeStorageSync(ACTIVE_SCOPE_KEY)
    wxApi.removeStorageSync(LEGACY_HISTORY_KEY)
    wxApi.removeStorageSync(AI_CONSENT_KEY)
  } catch (error) { /* 存储不可用时不影响云端身份流程 */ }
}

function reconcileXiaoBaScope(wxApi, bootstrap) {
  const next = historyKey(bootstrap)
  try {
    const previous = wxApi.getStorageSync(ACTIVE_SCOPE_KEY)
    wxApi.removeStorageSync(LEGACY_HISTORY_KEY)
    if (previous && previous !== next) {
      if (typeof previous === 'string' && previous.startsWith('huba_xiaoba_messages_v3:')) wxApi.removeStorageSync(previous)
      wxApi.removeStorageSync(AI_CONSENT_KEY)
    }
    if (next) wxApi.setStorageSync(ACTIVE_SCOPE_KEY, next)
    else wxApi.removeStorageSync(ACTIVE_SCOPE_KEY)
  } catch (error) { /* 本地缓存故障不影响进入小程序 */ }
  return next
}

module.exports = { ACTIVE_SCOPE_KEY, LEGACY_HISTORY_KEY, historyKey, reconcileXiaoBaScope, clearXiaoBaSession }
