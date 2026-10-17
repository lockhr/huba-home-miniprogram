const path = require('node:path')
const { inspectDeploymentEntrypoints } = require('./deployment-entrypoints.cjs')

const cloudFunctionsRoot = path.resolve(__dirname, '..', 'cloudfunctions')
const { missingApi, unexpectedEntrypoints } = inspectDeploymentEntrypoints(cloudFunctionsRoot)
const errors = []
if (missingApi) errors.push('缺少唯一允许部署的入口：cloudfunctions/api/index.js')
for (const name of unexpectedEntrypoints) errors.push(`发现其他可部署入口：cloudfunctions/${name}`)
for (const error of errors) console.error(`云函数部署入口检查失败：${error}`)
console.log(`云函数部署入口检查：${errors.length ? '失败' : '通过，仅包含 api'}`)
process.exitCode = errors.length ? 1 : 0
