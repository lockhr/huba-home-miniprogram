const { test } = require('node:test')
const assert = require('node:assert/strict')
const { toggleBlock, coursesFromBlocks } = require('../miniprogram/utils/schedule-fallback.js')

test('按星期和大节点选忙碌格，再点一次取消', () => {
  const selected = toggleBlock([], 1, 1)
  assert.deepEqual(selected, ['1:1'])
  assert.deepEqual(toggleBlock(selected, 1, 1), [])
})

test('手动确认格子只生成相应星期与节次，不推断周次或时间', () => {
  const courses = coursesFromBlocks(['2:3', '1:1', '2:3'])
  assert.deepEqual(courses, [
    { day: 1, title: '有课', time: '', period: '第1大节', weeks: '', place: '', teacher: '' },
    { day: 2, title: '有课', time: '', period: '第3大节', weeks: '', place: '', teacher: '' },
  ])
})

test('非法星期或节次不可被保存为课表', () => {
  assert.deepEqual(toggleBlock([], 0, 1), [])
  assert.deepEqual(toggleBlock([], 1, 9), [])
  assert.deepEqual(coursesFromBlocks(['8:1', '1:0', 'hello']), [])
})
