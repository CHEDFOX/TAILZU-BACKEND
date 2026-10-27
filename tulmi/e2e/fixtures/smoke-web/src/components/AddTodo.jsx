import { useState } from 'react'

export function AddTodo({ onAdd }) {
  const [text, setText] = useState('')

  const submit = (event) => {
    event.preventDefault()
    onAdd(text)
    setText('')
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="new-todo">New todo</label>
      <input id="new-todo" value={text} onChange={(event) => setText(event.target.value)} />
      <button type="submit">Add</button>
    </form>
  )
}
