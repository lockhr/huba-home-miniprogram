const crypto = require('node:crypto')
const https = require('node:https')

const HOST = 'ocr.tencentcloudapi.com'
const ACTION = 'RecognizeTableAccurateOCR'
const VERSION = '2018-11-19'
const SERVICE = 'ocr'
const MAX_BYTES = 5 * 1024 * 1024

function unavailable() {
  const error = new Error('课表识别暂不可用')
  error.code = 'SCHEDULE_OCR_UNAVAILABLE'
  return error
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest()
}

function authorization(body, timestamp, secretId, secretKey) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${HOST}\n`
  const canonical = `POST\n/\n\n${canonicalHeaders}\ncontent-type;host\n${sha256(body)}`
  const scope = `${date}/${SERVICE}/tc3_request`
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonical)}`
  const dateKey = hmac(`TC3${secretKey}`, date)
  const serviceKey = hmac(dateKey, SERVICE)
  const signingKey = hmac(serviceKey, 'tc3_request')
  const signature = hmac(signingKey, stringToSign).toString('hex')
  return `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`
}

function requestTencent({ host, headers, body }) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: host, port: 443, path: '/', method: 'POST', headers, timeout: 12000 }, response => {
      const chunks = []
      let total = 0
      response.on('data', chunk => {
        total += chunk.length
        if (total > 3 * 1024 * 1024) { request.destroy(unavailable()); return }
        chunks.push(chunk)
      })
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (_) { reject(unavailable()) }
      })
    })
    request.on('timeout', () => request.destroy(unavailable()))
    request.on('error', reject)
    request.end(body)
  })
}

function createScheduleOcr(cloud, env = process.env, transport = requestTencent) {
  return async fileId => {
    const secretId = env.TENCENTCLOUD_SECRETID
    const secretKey = env.TENCENTCLOUD_SECRETKEY
    const sessionToken = env.TENCENTCLOUD_SESSIONTOKEN
    if (!secretId || !secretKey || !sessionToken) throw unavailable()
    try {
      const downloaded = await cloud.downloadFile({ fileID: fileId })
      const image = downloaded && downloaded.fileContent
      if (!Buffer.isBuffer(image) || !image.length || image.length > MAX_BYTES) throw unavailable()
      const body = JSON.stringify({ ImageBase64: image.toString('base64'), UseNewModel: false })
      const timestamp = Math.floor(Date.now() / 1000)
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        Host: HOST,
        'X-TC-Action': ACTION,
        'X-TC-Version': VERSION,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Token': sessionToken,
        Authorization: authorization(body, timestamp, secretId, secretKey),
      }
      const result = await transport({ host: HOST, headers, body })
      if (!result || !result.Response || result.Response.Error || !Array.isArray(result.Response.TableDetections)) throw unavailable()
      return { TableDetections: result.Response.TableDetections }
    } catch (_) {
      // 不回传供应商的原始响应、图片内容或凭据。
      throw unavailable()
    }
  }
}

module.exports = { createScheduleOcr }
