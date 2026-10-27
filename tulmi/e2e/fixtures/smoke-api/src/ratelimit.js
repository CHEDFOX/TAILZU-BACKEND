'use strict'

/**
 * A fixed-window rate limit per client address. A client that makes more than `limit` requests in a
 * window gets 429 with a Retry-After header (seconds until its window ends) until the window is over.
 */
function rateLimit ({ limit = 60, windowMs = 60000, now = Date.now } = {}) {
  const clients = new Map()
  return function check (key) {
    const at = now()
    let entry = clients.get(key)
    if (!entry || at >= entry.resetAt) {
      entry = { count: 0, resetAt: at + windowMs }
      clients.set(key, entry)
    }
    entry.count += 1
    if (entry.count > limit) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - at) / 1000)) }
    }
    return { allowed: true, remaining: limit - entry.count }
  }
}

module.exports = { rateLimit }
