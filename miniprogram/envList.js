const config = require('./config.runtime.js')
module.exports = { envList: config.envId ? [{ envId: config.envId }] : [] }
