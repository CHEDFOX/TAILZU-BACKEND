import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TodoList } from '../src/components/TodoList.jsx'

const todos = [
  { id: '1', text: 'one', done: false },
  { id: '2', text: 'two', done: true }
]

test('renders a row per todo', () => {
  render(<TodoList todos={todos} onToggle={() => {}} onRemove={() => {}} />)
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
})

test('toggling and deleting call back with the id', async () => {
  const user = userEvent.setup()
  const onToggle = vi.fn()
  const onRemove = vi.fn()
  render(<TodoList todos={todos} onToggle={onToggle} onRemove={onRemove} />)
  await user.click(screen.getByLabelText('Done: one'))
  await user.click(screen.getByRole('button', { name: 'Delete two' }))
  expect(onToggle).toHaveBeenCalledWith('1')
  expect(onRemove).toHaveBeenCalledWith('2')
})
