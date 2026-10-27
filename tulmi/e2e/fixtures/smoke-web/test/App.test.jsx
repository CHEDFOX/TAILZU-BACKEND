import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../src/App.jsx'

async function addTodo(user, text) {
  await user.type(screen.getByLabelText('New todo'), text)
  await user.click(screen.getByRole('button', { name: 'Add' }))
}

test('shows an empty message until something is added', () => {
  render(<App />)
  expect(screen.getByText('Nothing to do.')).toBeInTheDocument()
})

test('adds a todo and clears the input', async () => {
  const user = userEvent.setup()
  render(<App />)
  await addTodo(user, 'buy milk')
  expect(screen.getByText('buy milk')).toBeInTheDocument()
  expect(screen.getByLabelText('New todo')).toHaveValue('')
})

test('ignores a blank todo', async () => {
  const user = userEvent.setup()
  render(<App />)
  await addTodo(user, '   ')
  expect(screen.getByText('Nothing to do.')).toBeInTheDocument()
})
