import { useId, type FormEvent } from 'react'
import type { Credentials } from '../api/client.ts'

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

const FIELD_CLASSES =
  'mt-2 block w-full rounded-md border border-ink-500 bg-ink-950 px-3.5 py-2.5 text-ink-100 placeholder:text-ink-400 ' +
  'outline-hidden transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/50 ' +
  'aria-invalid:border-danger/70'

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
    <form onSubmit={handleSubmit} className="w-full max-w-sm lg:max-w-md">
      <h1 className="text-2xl font-semibold text-ink-100">Sign in</h1>

      {/* Always mounted so screen readers are already watching it when a message appears. */}
      <div aria-live="polite" id={errorId}>
        {failure && (
          <p className="mt-6 flex items-center gap-2 rounded-md border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-sm text-danger">
            <span aria-hidden="true" className="font-bold">!</span>
            {FAILURE_MESSAGES[failure]}
          </p>
        )}
      </div>

      <div className="mt-6 space-y-5">
        <label className="block text-sm font-medium text-ink-100">
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
        <label className="block text-sm font-medium text-ink-100">
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

        {/* aria-disabled rather than disabled, so a keyboard user's focus stays on the button. */}
        <button
          type="submit"
          aria-disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 font-semibold text-accent-ink transition not-aria-disabled:hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-wait aria-disabled:opacity-85"
        >
          {submitting && <Spinner />}
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </form>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-4 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink"
    />
  )
}
