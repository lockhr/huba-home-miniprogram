const fs = require('node:fs')
const path = require('node:path')

function inspectDeploymentEntrypoints(cloudFunctionsRoot) {
  const deployableFunctions = fs.readdirSync(cloudFunctionsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(cloudFunctionsRoot, entry.name, 'index.js')))
    .map(entry => entry.name)
    .sort()

  return {
    missingApi: !deployableFunctions.includes('api'),
    unexpectedEntrypoints: deployableFunctions.filter(name => name !== 'api'),
  }
}

module.exports = { inspectDeploymentEntrypoints }
