import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { login, type Credentials } from '../api/client.ts'
import { BrandPanel } from './BrandPanel.tsx'
import { LoginForm, type LoginFailure, type LoginFormProps } from './LoginForm.tsx'

const HTTP_UNAUTHORIZED = 401

/** Resolves to the failure, or undefined once the session is signed in. */
async function submitLogin(credentials: Credentials): Promise<LoginFailure | undefined> {
  try {
    const response = await login(credentials)
    if (response.status === HTTP_UNAUTHORIZED) return 'bad-credentials'
    return response.ok ? undefined : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

export function LoginPage() {
  const navigate = useNavigate()
  const mutation = useMutation({
    mutationFn: submitLogin,
    onSuccess: (failure) => {
      if (!failure) void navigate({ to: '/' })
    },
  })

  return (
    <LoginScreen
      submitting={mutation.isPending}
      failure={mutation.data}
      onSubmit={(credentials) => mutation.mutate(credentials)}
    />
  )
}

/** The page without its data wiring, so each state can be rendered on its own. */
export function LoginScreen(props: LoginFormProps) {
  return (
    <main className="grid min-h-screen bg-ink-900 lg:grid-cols-2">
      <BrandPanel />
      <div className="flex items-start justify-center px-6 py-10 sm:px-10 lg:items-center">
        <LoginForm {...props} />
      </div>
    </main>
  )
}
