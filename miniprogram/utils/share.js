const message = Object.freeze({
  title: '胡巴家长们｜一起把每一天变得更好',
  path: '/pages/MainPage/index',
  imageUrl: '/images/share-cover.jpg',
})

function getShareMessage() {
  return { ...message }
}

module.exports = { getShareMessage }
