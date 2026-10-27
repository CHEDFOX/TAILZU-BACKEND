'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { start } = require('./helpers')

const post = (name, price) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, price }) })

test('health says which service it is', async () => {
  const app = await start({ serviceName: 'demo' })
  try {
    const res = await app.call('/health')
    assert.deepStrictEqual(res.body, { ok: true, service: 'demo' })
  } finally { await app.stop() }
})

test('an item that is created can be read back and listed', async () => {
  const app = await start()
  try {
    const made = await app.call('/items', post('pen', 1.5))
    assert.strictEqual(made.status, 201)
    const got = await app.call(`/items/${made.body.id}`)
    assert.strictEqual(got.body.name, 'pen')
    const list = await app.call('/items')
    assert.strictEqual(list.body.items.length, 1)
    assert.strictEqual(list.body.total, 1)
  } finally { await app.stop() }
})

test('a bad item is refused with 400', async () => {
  const app = await start()
  try {
    const res = await app.call('/items', post('', -1))
    assert.strictEqual(res.status, 400)
  } finally { await app.stop() }
})

test('deleting an item answers 204 and it is gone from the list', async () => {
  const app = await start()
  try {
    const made = await app.call('/items', post('pen', 1))
    const del = await app.call(`/items/${made.body.id}`, { method: 'DELETE' })
    assert.strictEqual(del.status, 204)
    assert.strictEqual((await app.call('/items')).body.total, 0)
  } finally { await app.stop() }
})
