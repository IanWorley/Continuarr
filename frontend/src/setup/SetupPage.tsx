import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { setUp, type SetupRequest } from '../api/client.ts'
import { AuthLayout } from '../auth/AuthLayout.tsx'
import { SetupForm, type SetupFailure, type SetupFormProps } from './SetupForm.tsx'

const HTTP_BAD_REQUEST = 400
const HTTP_FORBIDDEN = 403
const HTTP_CONFLICT = 409

// The statuses POST /api/setup documents in openapi.json, besides 204.
const FAILURE_BY_STATUS: ReadonlyMap<number, SetupFailure> = new Map([
  [HTTP_BAD_REQUEST, 'invalid-account'],
  [HTTP_FORBIDDEN, 'wrong-token'],
  [HTTP_CONFLICT, 'admin-exists'],
])

/** Resolves to the failure, or undefined once the admin exists. */
async function submitSetup(request: SetupRequest): Promise<SetupFailure | undefined> {
  try {
    const response = await setUp(request)
    if (response.ok) return undefined
    return FAILURE_BY_STATUS.get(response.status) ?? 'unavailable'
  } catch {
    return 'unavailable'
  }
}

export function SetupPage() {
  const navigate = useNavigate()
  const mutation = useMutation({
    mutationFn: submitSetup,
    onSuccess: (failure) => {
      if (!failure) void navigate({ to: '/login' })
    },
  })

  return (
    <SetupScreen
      submitting={mutation.isPending}
      failure={mutation.data}
      onSubmit={(request) => mutation.mutate(request)}
    />
  )
}

/** The page without its data wiring, so each state can be rendered on its own. */
export function SetupScreen(props: SetupFormProps) {
  return (
    <AuthLayout>
      <SetupForm {...props} />
    </AuthLayout>
  )
}
