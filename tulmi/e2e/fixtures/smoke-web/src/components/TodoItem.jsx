export function TodoItem({ todo, onToggle, onRemove }) {
  return (
    <li className={`todo-item${todo.done ? ' done' : ''}`}>
      <input type="checkbox" checked={todo.done} onChange={() => onToggle(todo.id)} aria-label={`Done: ${todo.text}`} />
      <span>{todo.text}</span>
      <button type="button" onClick={() => onRemove(todo.id)} aria-label={`Delete ${todo.text}`}>
        Delete
      </button>
    </li>
  )
}
