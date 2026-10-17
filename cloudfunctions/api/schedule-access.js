// 课表由部署者显式开启，空间自身只能进一步关闭，不能扩大部署权限。
function canUseSchedule(enabled) {
  return enabled === true
}

function requireScheduleAccess(enabled, fail) {
  if (!canUseSchedule(enabled)) fail('SCHEDULE_UNAVAILABLE')
  return true
}

module.exports = { canUseSchedule, requireScheduleAccess }

