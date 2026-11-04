// @vitest-environment jsdom
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { queryClient } from '../queryClient.ts'
import { router } from '../router.tsx'

const UNREACHABLE_MESSAGE = /Couldn't reach Continuarr/
const SIGNING_IN_LABEL = 'Signing in…'

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')))
  // The router restores scroll on navigation, and jsdom has no scrollTo.
  vi.stubGlobal('scrollTo', vi.fn())
  await router.navigate({ to: '/login' })
})

afterEach(() => {
  cleanup()
  onlineManager.setOnline(true)
  queryClient.clear()
  vi.unstubAllGlobals()
})

it('reports an unreachable server instead of pausing while the browser says it is offline', async () => {
  onlineManager.setOnline(false)
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'admin' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

  expect(await screen.findByText(UNREACHABLE_MESSAGE)).toBeDefined()
  expect(screen.queryByText(SIGNING_IN_LABEL)).toBeNull()
})
