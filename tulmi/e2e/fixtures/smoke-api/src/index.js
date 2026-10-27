'use strict'

const { createApp } = require('./app')
const { loadConfig } = require('./config')

const config = loadConfig()
createApp().listen(config.port, () => {
  console.log(`${config.serviceName} listening on ${config.port}`)
})
