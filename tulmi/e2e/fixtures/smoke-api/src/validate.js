'use strict'

/** What is wrong with a new item, as a list of messages (empty when it is fine). */
function validateItem (body) {
  const problems = []
  if (!body || typeof body !== 'object') return ['the body must be a JSON object']
  if (typeof body.name !== 'string' || body.name.trim() === '') problems.push('name must be a non-empty string')
  if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0) problems.push('price must be a number, zero or more')
  return problems
}

module.exports = { validateItem }
