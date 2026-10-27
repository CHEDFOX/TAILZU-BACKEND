import { TodoItem } from './TodoItem.jsx'

export function TodoList({ todos, onToggle, onRemove }) {
  if (todos.length === 0) return <p>Nothing to do.</p>
  return (
    <ul>
      {todos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} onToggle={onToggle} onRemove={onRemove} />
      ))}
    </ul>
  )
}
