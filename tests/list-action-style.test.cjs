const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '../miniprogram')

test('all swipe actions use the same labelled style without replacing gesture handlers', () => {
  for (const page of ['Mission', 'Market', 'Account']) {
    const source = fs.readFileSync(path.join(root, 'pages', page, 'index.wxml'), 'utf8')
    const actions = source.match(/<mp-slideview\b[^>]*>/g)
    assert.equal(actions.length, 2)
    for (const tag of actions) {
      assert.match(tag, /ext-class="huba-actions"/)
      assert.match(tag, /icon="\{\{false\}\}"/)
      assert.match(tag, /disable="\{\{actionBusy\}\}"/)
      assert.match(tag, /bindbuttontap="slideButtonTap(?:Upper|Lower)"/)
    }
  }
})

test('shared action styling provides readable touch targets and semantic icon colours', () => {
  const file = path.join(root, 'styles/list-actions.wxss')
  assert.ok(fs.existsSync(file), 'shared action stylesheet exists')
  const style = fs.readFileSync(file, 'utf8')
  assert.match(style, /min-height:\s*44px/)
  assert.match(style, /prefers-reduced-motion/)
  for (const type of ['buyBtn', 'markBtn', 'useBtn', 'starBtn', 'removeBtn']) {
    assert.ok(style.includes('.' + type), type)
  }
  assert.match(fs.readFileSync(path.join(root, 'app.wxss'), 'utf8'), /@import\s+['"]styles\/list-actions.wxss['"]/)
})

test('space buttons keep card gutters and help links stay content-sized', () => {
  const style = fs.readFileSync(path.join(root, 'styles/experience.wxss'), 'utf8')
  const primary = style.match(/\.ux-page button\.space-submit\s*\{([^}]+)\}/)[1]
  assert.match(primary, /width:\s*calc\(100% - 56rpx\)/)
  assert.match(primary, /margin:\s*30rpx 28rpx 0/)
  assert.match(style, /\.ux-page \.space-help-link\s*\{[^}]*display:\s*inline-flex/)
})
