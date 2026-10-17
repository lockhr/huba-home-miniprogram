function enabledBy(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true'
}

function pausedFeatures(value) {
  return new Set(String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean))
}

function runtimeCapabilitiesFrom(env = {}) {
  const paused = pausedFeatures(env.HUBA_PAUSE)
  return {
    schedule: enabledBy(env.HUBA_FEATURE_SCHEDULE),
    xiaoba: Boolean(String(env.DEEPSEEK_API_KEY || '').trim()) && !paused.has('ai'),
  }
}

module.exports = { enabledBy, pausedFeatures, runtimeCapabilitiesFrom }
