'use strict'

const MAX_LIMIT = 100

/**
 * One page of a list. Pages start at 1: page 1 is the first `limit` items.
 */
function paginate (items, { page = 1, limit = 10 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 10, 1), MAX_LIMIT)
  const number = Math.max(Number(page) || 0, 0)
  const start = number * size
  return {
    page: number,
    limit: size,
    total: items.length,
    items: items.slice(start, start + size)
  }
}

module.exports = { paginate, MAX_LIMIT }
