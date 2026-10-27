import { AddTodo } from './components/AddTodo.jsx'
import { TodoList } from './components/TodoList.jsx'
import { useTodos } from './hooks/useTodos.js'

export function App({ initial }) {
  const { todos, add, toggle, remove } = useTodos(initial)

  return (
    <main>
      <h1>Todos</h1>
      <AddTodo onAdd={add} />
      <TodoList todos={todos} onToggle={toggle} onRemove={remove} />
    </main>
  )
}
