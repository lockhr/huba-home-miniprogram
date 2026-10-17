const AI_CONSENT_KEY = 'huba_xiaoba_ai_consent_v1'

function ensureAiConsent(wxApi) {
  try {
    if (wxApi.getStorageSync(AI_CONSENT_KEY) === true) return Promise.resolve(true)
  } catch (error) { /* 本地存储不可用时继续询问 */ }

  return new Promise(resolve => {
    wxApi.showModal({
      title: '使用小八前请确认',
      content: '你的提问，以及本空间中与问题相关的任务、心情、步数、家规、菜单、记录和愿望摘要，会发送给第三方 AI 服务 DeepSeek 生成回复。请勿发送身份证号、密码等敏感信息。是否同意并继续？',
      confirmText: '同意使用',
      cancelText: '暂不使用',
      confirmColor: '#ff5d94',
      success: result => {
        if (!result || !result.confirm) return resolve(false)
        try { wxApi.setStorageSync(AI_CONSENT_KEY, true) } catch (error) { /* 同意仍对本次有效 */ }
        resolve(true)
      },
      fail: () => resolve(false),
    })
  })
}

module.exports = { AI_CONSENT_KEY, ensureAiConsent }
