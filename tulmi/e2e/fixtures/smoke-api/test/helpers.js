'use strict'

const { createApp } = require('../src/app')

/** Starts the app on a free port; returns a way to call it and to stop it. */
async function start (options = {}) {
  const server = createApp(options)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    base,
    async call (path, init = {}) {
      const res = await fetch(base + path, init)
      const text = await res.text()
      return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined }
    },
    stop: () => new Promise((resolve) => server.close(resolve))
  }
}

module.exports = { start }
