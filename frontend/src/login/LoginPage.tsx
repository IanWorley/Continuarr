import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { login, type Credentials } from '../api/client.ts'
import { AuthLayout } from '../auth/AuthLayout.tsx'
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

// Plain state rather than useMutation, whose cache would keep the password for 5 minutes after the submit.
export function LoginPage() {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<LoginFailure>()

  async function signIn(credentials: Credentials) {
    setSubmitting(true)
    setFailure(undefined)
    const result = await submitLogin(credentials)
    setSubmitting(false)
    setFailure(result)
    if (!result) void navigate({ to: '/' })
  }

  return <LoginScreen submitting={submitting} failure={failure} onSubmit={(credentials) => void signIn(credentials)} />
}

/** The page without its data wiring, so each state can be rendered on its own. */
export function LoginScreen(props: LoginFormProps) {
  return (
    <AuthLayout>
      <LoginForm {...props} />
    </AuthLayout>
  )
}
