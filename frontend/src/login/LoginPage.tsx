import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { login, type Credentials } from '../api/client.ts'
import { BrandPanel } from './BrandPanel.tsx'
import { LoginForm } from './LoginForm.tsx'

const HTTP_UNAUTHORIZED = 401

type LoginFailure = 'bad-credentials' | 'unavailable'

const FAILURE_MESSAGES: Record<LoginFailure, string> = {
  'bad-credentials': 'Wrong username or password',
  unavailable: "Couldn't reach Continuarr. Try again in a moment.",
}

async function submitLogin(credentials: Credentials): Promise<void> {
  const response = await login(credentials).catch(() => {
    throw new Error(FAILURE_MESSAGES.unavailable)
  })
  if (response.status === HTTP_UNAUTHORIZED) throw new Error(FAILURE_MESSAGES['bad-credentials'])
  if (!response.ok) throw new Error(FAILURE_MESSAGES.unavailable)
}

export function LoginPage() {
  const navigate = useNavigate()
  const mutation = useMutation({
    mutationFn: submitLogin,
    onSuccess: () => navigate({ to: '/' }),
  })

  return (
    <LoginScreen
      submitting={mutation.isPending}
      errorMessage={mutation.error?.message}
      onSubmit={(credentials) => mutation.mutate(credentials)}
    />
  )
}

/** The page without its data wiring, so each state can be rendered on its own. */
export function LoginScreen(props: Parameters<typeof LoginForm>[0]) {
  return (
    <main className="grid min-h-screen bg-ink-900 lg:grid-cols-[1.15fr_1fr]">
      <BrandPanel />
      <div className="flex items-start justify-center px-6 py-10 sm:px-10 lg:items-center">
        <LoginForm {...props} />
      </div>
    </main>
  )
}
