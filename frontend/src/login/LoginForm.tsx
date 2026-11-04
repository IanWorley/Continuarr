import { useId, type FormEvent } from 'react'
import type { Credentials } from '../api/client.ts'
import { FIELD_CLASSES, FORM_CLASSES, FormAlert, HEADING_CLASSES, LABEL_CLASSES, SubmitButton } from '../auth/formParts.tsx'

export type LoginFailure = 'bad-credentials' | 'unavailable'

const FAILURE_MESSAGES: Record<LoginFailure, string> = {
  'bad-credentials': 'Wrong username or password',
  unavailable: "Couldn't reach Continuarr. Try again in a moment.",
}

export interface LoginFormProps {
  submitting: boolean
  failure: LoginFailure | undefined
  onSubmit: (credentials: Credentials) => void
}

export function LoginForm({ submitting, failure, onSubmit }: LoginFormProps) {
  const errorId = useId()
  // Only a rejected login means the fields are wrong; an unreachable server says nothing about them.
  const credentialsInvalid = failure === 'bad-credentials'

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const form = new FormData(event.currentTarget)
    onSubmit({ username: String(form.get('username')), password: String(form.get('password')) })
  }

  return (
    <form onSubmit={handleSubmit} className={FORM_CLASSES}>
      <h1 className={HEADING_CLASSES}>Sign in</h1>

      <FormAlert id={errorId}>{failure && FAILURE_MESSAGES[failure]}</FormAlert>

      <div className="mt-6 space-y-5">
        <label className={LABEL_CLASSES}>
          Username
          <input
            name="username"
            autoComplete="username"
            required
            aria-invalid={credentialsInvalid}
            aria-describedby={failure ? errorId : undefined}
            className={FIELD_CLASSES}
          />
        </label>
        <label className={LABEL_CLASSES}>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={credentialsInvalid}
            aria-describedby={failure ? errorId : undefined}
            className={FIELD_CLASSES}
          />
        </label>

        <SubmitButton submitting={submitting} label="Sign in" submittingLabel="Signing in…" />
      </div>
    </form>
  )
}
