'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { validateItem } = require('../src/validate')

test('a good item has no problems', () => {
  assert.deepStrictEqual(validateItem({ name: 'pen', price: 2 }), [])
})

test('a missing name and a negative price are both reported', () => {
  assert.strictEqual(validateItem({ price: -1 }).length, 2)
})

test('something that is not an object is refused', () => {
  assert.strictEqual(validateItem(null).length, 1)
})
