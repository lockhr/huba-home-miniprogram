const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.join(__dirname, '../miniprogram')

function setup(confirm = true) {
  const events = []
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/list-feedback.js'), 'utf8'), {
    module, wx: {
      showModal({ success }) { events.push('confirm'); success({ confirm }) },
      showLoading() { events.push('loading') }, hideLoading() { events.push('hide') },
      showToast({ title }) { events.push(title) },
    },
  })
  const page = { data: {}, setData(patch) { Object.assign(this.data, patch) } }
  return { ...module.exports, page, events }
}

test('list failure keeps old content, exposes retry and resets loading', async () => {
  const { page, loadList } = setup()
  page.data = { loaded: true, rows: ['old'] }
  await loadList(page, async () => { throw new Error('private backend error') }, () => assert.fail('cannot present failure'), '任务')
  assert.deepEqual(page.data.rows, ['old'])
  assert.match(page.data.loadError, /重试.*保留/)
  assert.doesNotMatch(page.data.loadError, /private/)
  assert.equal(page.data.loading, false)
  await loadList(page, async () => ['new'], rows => page.setData({ rows }), '任务')
  assert.deepEqual(page.data.rows, ['new'])
  assert.equal(page.data.loadError, '')
})

test('concurrent loads are coalesced', async () => {
  const { page, loadList } = setup()
  let resolve, count = 0
  const read = () => { count++; return new Promise(done => { resolve = done }) }
  const first = loadList(page, read, () => {}, '任务')
  const second = loadList(page, read, () => {}, '任务')
  resolve([])
  await Promise.all([first, second])
  assert.equal(count, 1)
  assert.equal(page.data.loading, false)
})

test('cancel delete does not write or leave busy state', async () => {
  const { page, runListAction, events } = setup(false)
  assert.equal(await runListAction(page, () => assert.fail('must not delete'), { confirm: { title: '删除？' } }), false)
  assert.equal(page.data.actionBusy, false)
  assert.deepEqual(events, ['confirm'])
})

test('rapid repeat action writes once and failure restores controls', async () => {
  const { page, runListAction, events } = setup()
  let reject, calls = 0
  const job = () => { calls++; return new Promise((_, fail) => { reject = fail }) }
  const first = runListAction(page, job)
  assert.equal(await runListAction(page, job), false)
  reject(new Error('这次没有完成'))
  assert.equal(await first, false)
  assert.equal(calls, 1)
  assert.equal(page.data.actionBusy, false)
  assert.deepEqual(events, ['loading', 'hide', '这次没有完成'])
})

test('header reserves block flow space and adapts below device status bar', () => {
  const style = fs.readFileSync(path.join(root, 'components/page-heading/index.wxss'), 'utf8')
  assert.match(style, /:host\s*\{[^}]*display:\s*block/)
  let component
  vm.runInNewContext(fs.readFileSync(path.join(root, 'components/page-heading/index.js'), 'utf8'), {
    Component: value => { component = value },
    wx: { getWindowInfo: () => ({ statusBarHeight: 54, windowWidth: 320 }), getMenuButtonBoundingClientRect: () => ({ left: 224 }) },
  })
  component.setData = patch => Object.assign(component.data, patch)
  component.lifetimes.attached.call(component)
  assert.ok(component.data.top >= 54)
  assert.ok(component.data.height >= component.data.top + 60)
  assert.ok(component.data.copyWidth <= 224 - 16)
})

test('WXML controls do not repeat disabled or loading attributes', () => {
  for (const name of fs.readdirSync(path.join(root, 'pages'))) {
    const file = path.join(root, 'pages', name, 'index.wxml')
    if (!fs.existsSync(file)) continue
    const source = fs.readFileSync(file, 'utf8')
    for (const tag of source.match(/<[\w-]+\b[^>]*>/g) || []) {
      assert.ok((tag.match(/\bdisabled=/g) || []).length <= 1, name + ': duplicate disabled')
      assert.ok((tag.match(/\bloading=/g) || []).length <= 1, name + ': duplicate loading')
    }
  }
})
