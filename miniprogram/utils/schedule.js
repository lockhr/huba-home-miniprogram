// 公共包里只保留课表的「结构」：星期标签和时间规则。
// 真实课表属于用户数据，存在云端 ScheduleList，按 spaceId 隔离，不进代码包。
const DAY_LABELS = [
  { value: 1, short: '一', label: '周一' },
  { value: 2, short: '二', label: '周二' },
  { value: 3, short: '三', label: '周三' },
  { value: 4, short: '四', label: '周四' },
  { value: 5, short: '五', label: '周五' },
  { value: 6, short: '六', label: '周六' },
  { value: 7, short: '日', label: '周日' },
]

// 作息规则：判断「今天有没有课」时必须同时核对星期、课程周次和当前教学周。
const SEASON_RULE = '课表按学期周次执行，当前执行夏令时：第4大节14:30开始，第7大节19:10开始。判断某天是否上课时必须同时核对星期、课程周次和当前教学周；无法确认教学周时要明确说明。'

const PERIODS = ['第1大节（01–02节）', '第2大节（03–04节）', '第3大节（05节）', '第4大节（06–07节）', '第5大节（08–09节）', '第6大节（10节）', '第7大节（11–12节）', '第8大节（13节）']

module.exports = { DAY_LABELS, PERIODS, SEASON_RULE }
