import { useId, type FormEvent } from 'react'
import type { Credentials } from '../api/client.ts'

interface LoginFormProps {
  submitting: boolean
  /** Shown inline and announced to screen readers; undefined when there is nothing to report. */
  errorMessage: string | undefined
  onSubmit: (credentials: Credentials) => void
}

const FIELD_CLASSES =
  'mt-2 block w-full rounded-md border border-ink-700 bg-ink-950 px-3.5 py-2.5 text-ink-100 placeholder:text-ink-400 ' +
  'outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/50 ' +
  'aria-invalid:border-danger/70 disabled:opacity-60'

export function LoginForm({ submitting, errorMessage, onSubmit }: LoginFormProps) {
  const errorId = useId()
  const hasError = errorMessage !== undefined

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    onSubmit({ username: String(form.get('username')), password: String(form.get('password')) })
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm">
      <h2 className="text-2xl font-semibold text-ink-100">Sign in</h2>
      <p className="mt-1.5 text-sm text-ink-400">Use the admin account you created during setup.</p>

      <div aria-live="polite" id={errorId} className="mt-6 empty:hidden">
        {hasError && (
          <p className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-sm text-danger">
            <span aria-hidden="true" className="font-bold">!</span>
            {errorMessage}
          </p>
        )}
      </div>

      <fieldset disabled={submitting} className="mt-6 space-y-5">
        <label className="block text-sm font-medium text-ink-100">
          Username
          <input
            name="username"
            autoComplete="username"
            required
            aria-invalid={hasError}
            aria-describedby={hasError ? errorId : undefined}
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
            aria-invalid={hasError}
            aria-describedby={hasError ? errorId : undefined}
            className={FIELD_CLASSES}
          />
        </label>

        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 font-semibold text-accent-ink transition hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-70"
        >
          {submitting && <Spinner />}
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </fieldset>
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
