// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SetupForm } from './SetupForm.tsx'

const PASSWORD = 'correct-horse-battery'
const MISTYPED_PASSWORD = 'correct-horse-batterz'
const MISMATCH_MESSAGE = "The passwords don't match."

afterEach(cleanup)

it('stops mismatched passwords before anything is sent', () => {
  const onSubmit = vi.fn()
  render(<SetupForm submitting={false} failure={undefined} onSubmit={onSubmit} />)

  fireEvent.change(screen.getByLabelText('Setup token'), { target: { value: 'token' } })
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: MISTYPED_PASSWORD } })
  fireEvent.click(screen.getByRole('button', { name: 'Create admin' }))

  expect(screen.getByText(MISMATCH_MESSAGE)).toBeDefined()
  expect(screen.getByLabelText('Confirm password').getAttribute('aria-invalid')).toBe('true')
  expect(onSubmit).not.toHaveBeenCalled()
})
