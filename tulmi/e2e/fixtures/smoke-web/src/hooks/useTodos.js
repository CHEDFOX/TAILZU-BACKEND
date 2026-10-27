import { useCallback, useState } from 'react'

/** The todo list: items of { id, text, done }, and what can be done to them. */
export function useTodos(initial = []) {
  const [todos, setTodos] = useState(initial)

  const add = useCallback((text) => {
    const clean = text.trim()
    if (!clean) return
    setTodos((list) => [...list, { id: crypto.randomUUID(), text: clean, done: false }])
  }, [])

  const toggle = useCallback((id) => {
    setTodos((list) => list.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo)))
  }, [])

  const remove = useCallback((id) => {
    setTodos((list) => list.filter((todo) => todo.id !== id))
  }, [])

  return { todos, add, toggle, remove }
}
