'use strict'

const fs = require('node:fs')
const path = require('node:path')

const defaults = {
  port: 3000,
  serviceName: 'smoke-api',
  limit: 60,
  windowMs: 60000
}

/**
 * The settings: the defaults, over which `config/local.json` (when there is one) is laid.
 */
function loadConfig (root = path.join(__dirname, '..')) {
  const file = path.join(root, 'config', 'local.json')
  let local = {}
  if (fs.existsSync(file)) local = JSON.parse(fs.readFileSync(file, 'utf8'))
  return { ...defaults, ...local }
}

module.exports = { defaults, loadConfig }
