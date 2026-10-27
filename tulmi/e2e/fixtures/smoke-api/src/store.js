'use strict'

/** Items in memory: an id, a name and a price. */
class Store {
  constructor () {
    this.items = []
    this.nextId = 1
  }

  list () {
    return this.items.slice()
  }

  get (id) {
    return this.items.find((item) => item.id === id) ?? null
  }

  create ({ name, price }) {
    const item = { id: this.nextId++, name, price }
    this.items.push(item)
    return item
  }

  remove (id) {
    const before = this.items.length
    this.items = this.items.filter((item) => item.id !== id)
    return this.items.length < before
  }
}

module.exports = { Store }
