'use strict'

const http = require('node:http')
const { loadConfig } = require('./config')
const { paginate } = require('./pagination')
const { rateLimit } = require('./ratelimit')
const { Store } = require('./store')
const { validateItem } = require('./validate')

function send (res, status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(text)
}

function readJson (req) {
  return new Promise((resolve, reject) => {
    let text = ''
    req.on('data', (chunk) => { text += chunk })
    req.on('end', () => {
      try { resolve(text ? JSON.parse(text) : {}) } catch (err) { reject(err) }
    })
  })
}

/** The server: routes, the rate limit in front of every one of them, the store behind. */
function createApp (options = {}) {
  const config = { ...loadConfig(), ...options }
  const store = options.store ?? new Store()
  const check = rateLimit({ limit: config.limit, windowMs: config.windowMs, ...(options.now ? { now: options.now } : {}) })

  return http.createServer(async (req, res) => {
    const verdict = check(req.socket.remoteAddress ?? 'unknown')
    if (!verdict.allowed) {
      return send(res, 429, { error: 'too many requests' }, { 'retry-after': String(verdict.retryAfterSec) })
    }
    const url = new URL(req.url, 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean)

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, service: config.serviceName })
    }
    if (parts[0] === 'items' && parts.length === 1) {
      if (req.method === 'GET') {
        const page = url.searchParams.get('page') ?? 0
        const limit = url.searchParams.get('limit') ?? 10
        return send(res, 200, paginate(store.list(), { page, limit }))
      }
      if (req.method === 'POST') {
        let body
        try { body = await readJson(req) } catch { return send(res, 400, { error: 'invalid JSON' }) }
        const problems = validateItem(body)
        if (problems.length) return send(res, 400, { error: problems.join('; ') })
        return send(res, 201, store.create(body))
      }
    }
    if (parts[0] === 'items' && parts.length === 2) {
      const id = Number(parts[1])
      if (req.method === 'GET') return send(res, 200, store.get(id))
      if (req.method === 'DELETE') {
        store.remove(id)
        return send(res, 204)
      }
    }
    return send(res, 404, { error: 'not found' })
  })
}

module.exports = { createApp }
