import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { setUp, type SetupRequest } from '../api/client.ts'
import { AuthLayout } from '../auth/AuthLayout.tsx'
import { SetupForm, type SetupFailure, type SetupFormProps } from './SetupForm.tsx'

const HTTP_BAD_REQUEST = 400
const HTTP_FORBIDDEN = 403
const HTTP_CONFLICT = 409

// The failures POST /api/setup documents in openapi.json.
const FAILURE_BY_STATUS: ReadonlyMap<number, SetupFailure> = new Map([
  [HTTP_BAD_REQUEST, 'invalid-account'],
  [HTTP_FORBIDDEN, 'wrong-token'],
])

/** Resolves to the failure, or undefined once the admin exists. */
async function submitSetup(request: SetupRequest): Promise<SetupFailure | undefined> {
  try {
    const response = await setUp(request)
    // A conflict means another request already created the admin, so signing in is next either way.
    if (response.ok || response.status === HTTP_CONFLICT) return undefined
    return FAILURE_BY_STATUS.get(response.status) ?? 'unavailable'
  } catch {
    return 'unavailable'
  }
}

// Plain state rather than useMutation, whose cache would keep the setup token and password for 5 minutes after the submit.
export function SetupPage() {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<SetupFailure>()

  async function createAdmin(request: SetupRequest) {
    setSubmitting(true)
    setFailure(undefined)
    const result = await submitSetup(request)
    setSubmitting(false)
    setFailure(result)
    if (!result) void navigate({ to: '/login' })
  }

  return <SetupScreen submitting={submitting} failure={failure} onSubmit={(request) => void createAdmin(request)} />
}

/** The page without its data wiring, so each state can be rendered on its own. */
export function SetupScreen(props: SetupFormProps) {
  return (
    <AuthLayout>
      <SetupForm {...props} />
    </AuthLayout>
  )
}
