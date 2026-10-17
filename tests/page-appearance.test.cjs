const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '../miniprogram/pages')

function read(page, extension) {
  return fs.readFileSync(path.join(root, page, `index.${extension}`), 'utf8')
}

test('所有批准页面只在原有图片位读取对应的共享主题图', () => {
  const bindings = {
    Mission: 'mission',
    MissionAdd: 'mission',
    MissionDetail: 'mission',
    Market: 'market',
    MarketAdd: 'market',
    MarketDetail: 'market',
    ItemDetail: 'market',
    Records: 'records',
    Dinner: 'dinner',
    Account: 'storage',
    HouseRules: 'rules',
  }

  for (const [page, slot] of Object.entries(bindings)) {
    const source = read(page, 'js')
    const markup = read(page, 'wxml')
    assert.match(source, /refreshPageAppearance/, `${page} 应在 onShow 刷新统一装扮视图`)
    assert.match(markup, new RegExp(`src="\\{\\{appearance\\.${slot}\\}\\}"`), `${page} 应绑定 ${slot}`)
    assert.doesNotMatch(markup, /appearance-attachment|theme-photo-extra/, `${page} 不应增加正文照片块`)
  }
})

test('同模块页面复用一张主题图而不是创建重复槽位', () => {
  for (const page of ['Mission', 'MissionAdd', 'MissionDetail']) {
    assert.match(read(page, 'wxml'), /appearance\.mission/)
  }
  for (const page of ['Market', 'MarketAdd', 'MarketDetail', 'ItemDetail']) {
    assert.match(read(page, 'wxml'), /appearance\.market/)
  }
  assert.match(read('HouseRules', 'wxml'), /appearance\.rules/)
})
