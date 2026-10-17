const { getShareMessage } = require('../../utils/share.js')

Page({
  onShareAppMessage() {
    return { ...getShareMessage(), title: '胡巴家长们 · 使用说明', path: '/pages/Help/index' }
  },

  data: {
    openFaq: -1,
    faqs: [
      { question: '邀请分享不了怎么办？', answer: '让创建者在空间设置里点“一键复制邀请码”，再通过普通微信消息发送。接收方在首次设置页粘贴即可。' },
      { question: '为什么我不能加入另一个空间？', answer: '一个微信账号同一时间只能加入一个空间。需要先在原空间选择“离开当前空间”，再使用新的邀请码。' },
      { question: '注销申请后为什么还能使用？', answer: '双人空间要等待另一方确认。对方同意前空间仍可正常使用；双方确认后直接开始清理。' },
      { question: '小八为什么没有出现？', answer: '小八只在双方已经配对、空间正常并开启该功能时出现。首次设置、等待伴侣和注销流程中都会隐藏。' },
    ],
  },

  toggleFaq(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ openFaq: this.data.openFaq === index ? -1 : index })
  },
})
