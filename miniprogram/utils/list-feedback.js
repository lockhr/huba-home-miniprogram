// View-state helpers only; authorization and writes stay in the existing API.
async function loadList(page, read, present, label) {
  if (page._listLoading) return page._listLoading
  page.setData({ loading: true, loadError: '' })
  page._listLoading = (async () => {
    try {
      const result = await read()
      await present(result)
      page.setData({ loaded: true })
    } catch (_) {
      page.setData({ loadError: `暂时没能读取${label}，请重试${page.data.loaded ? '。下方保留上次读取的内容' : ''}` })
    } finally {
      page.setData({ loading: false })
    }
  })()
  try { await page._listLoading } finally { page._listLoading = null }
}

async function runListAction(page, job, options = {}) {
  if (page.data.actionBusy) return false
  page.setData({ actionBusy: true })
  let shown = false
  let notice = ''
  let success = false
  try {
    if (options.confirm) {
      const confirmed = await new Promise(resolve => wx.showModal({
        title: options.confirm.title,
        content: options.confirm.content,
        confirmText: options.confirm.confirmText || '确认删除',
        cancelText: '保留',
        confirmColor: '#b9456b',
        success: result => resolve(Boolean(result.confirm)),
        fail: () => resolve(false),
      }))
      if (!confirmed) return false
    }
    wx.showLoading({ title: '正在处理…', mask: true })
    shown = true
    await job()
    success = true
    notice = options.success || '已更新'
    return true
  } catch (error) {
    notice = error && error.message || '这次没有完成，请重试'
    return false
  } finally {
    if (shown) wx.hideLoading()
    page.setData({ actionBusy: false })
    if (notice) wx.showToast({ title: notice, icon: success ? 'success' : 'none', duration: 2400 })
  }
}

function updateRow(rows, id, patch) {
  return rows.map(row => row._id === id ? { ...row, ...patch } : row)
}

module.exports = { loadList, runListAction, updateRow }
