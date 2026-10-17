const config = require('../config.runtime.js')

const STORAGE_KEY = 'huba_partner_reminder_status_v1'
const AUTO_RENEW_KEY = 'huba_partner_reminder_auto_renew_v1'

function templateId() {
  return typeof config.subscribeTemplateId === 'string' ? config.subscribeTemplateId.trim() : ''
}

function readCachedStatus() {
  try { return wx.getStorageSync(STORAGE_KEY) || '' } catch (error) { return '' }
}

function cacheStatus(status) {
  try { wx.setStorageSync(STORAGE_KEY, status) } catch (error) {}
}

function cacheAutoRenew(enabled) {
  try { wx.setStorageSync(AUTO_RENEW_KEY, enabled === true) } catch (error) {}
}

function readAutoRenew() {
  try { return wx.getStorageSync(AUTO_RENEW_KEY) === true } catch (error) { return false }
}

function statusView(status) {
  if (status === 'accept') return { status, ready: true, text: '接收次数以首页数字为准', action: '补充 1 次提醒' }
  if (status === 'reject' || status === 'ban') return { status, ready: false, text: '微信提醒已关闭，点这里重新设置', action: '去设置' }
  if (status === 'unconfigured') return { status, ready: false, text: '提醒模板还差最后一步配置', action: '待配置' }
  return { status: 'unknown', ready: false, text: '点一下，及时收到对方的下一条动态', action: '开启' }
}

function getSetting() {
  return new Promise(resolve => {
    if (!wx.getSetting) return resolve(null)
    wx.getSetting({ withSubscriptions: true, success: resolve, fail: () => resolve(null) })
  })
}

function syncAutoRenewPreference(setting) {
  const id = templateId()
  const subscriptions = setting && setting.subscriptionsSetting
  const itemStatus = subscriptions && subscriptions.itemSettings && subscriptions.itemSettings[id]
  const enabled = Boolean(subscriptions && subscriptions.mainSwitch !== false && itemStatus === 'accept')
  cacheAutoRenew(enabled)
  return enabled
}

async function getPartnerReminderStatus() {
  const id = templateId()
  if (!id) return statusView('unconfigured')
  const setting = await getSetting()
  const subscriptions = setting && setting.subscriptionsSetting
  syncAutoRenewPreference(setting)
  if (subscriptions && subscriptions.mainSwitch === false) return statusView('reject')
  const itemStatus = subscriptions && subscriptions.itemSettings && subscriptions.itemSettings[id]
  return statusView(itemStatus || readCachedStatus())
}

function requestPartnerReminder() {
  const id = templateId()
  if (!id) return Promise.resolve(statusView('unconfigured'))
  if (!wx.requestSubscribeMessage) return Promise.reject(new Error('当前微信版本不支持订阅提醒'))
  return new Promise((resolve, reject) => wx.requestSubscribeMessage({
    tmplIds: [id],
    async success(result) {
      const status = result && result[id]
      cacheStatus(status)
      const setting = await getSetting()
      syncAutoRenewPreference(setting)
      resolve(statusView(status))
    },
    fail: reject,
  }))
}

function requestAutoPartnerReminder() {
  if (!readAutoRenew()) return Promise.resolve(null)
  return requestPartnerReminder()
}

module.exports = {
  getPartnerReminderStatus,
  requestPartnerReminder,
  requestAutoPartnerReminder,
}
