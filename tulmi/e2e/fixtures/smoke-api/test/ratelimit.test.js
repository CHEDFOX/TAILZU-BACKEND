'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { rateLimit } = require('../src/ratelimit')

test('requests up to the limit are allowed, the next is not', () => {
  const check = rateLimit({ limit: 2, windowMs: 1000, now: () => 0 })
  assert.strictEqual(check('a').allowed, true)
  assert.strictEqual(check('a').allowed, true)
  const third = check('a')
  assert.strictEqual(third.allowed, false)
  assert.strictEqual(third.retryAfterSec, 1)
})

test('a new window starts after windowMs', () => {
  let t = 0
  const check = rateLimit({ limit: 1, windowMs: 1000, now: () => t })
  assert.strictEqual(check('a').allowed, true)
  assert.strictEqual(check('a').allowed, false)
  t = 1000
  assert.strictEqual(check('a').allowed, true)
})

test('clients are counted separately', () => {
  const check = rateLimit({ limit: 1, windowMs: 1000, now: () => 0 })
  assert.strictEqual(check('a').allowed, true)
  assert.strictEqual(check('b').allowed, true)
})
