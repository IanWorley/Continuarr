import { useId, useState, type SubmitEvent } from 'react'
import type { SetupRequest } from '../api/client.ts'
import { FIELD_CLASSES, FORM_CLASSES, FormAlert, HEADING_CLASSES, LABEL_CLASSES, SubmitButton } from '../forms/formParts.tsx'
import { textField } from '../forms/textField.ts'

// Mirror SetupController's rules so the message can name them. The server counts the maximum in
// UTF-8 bytes, so a password with accented letters or emoji can hit it before 72 characters.
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_BYTES = 72

export type SetupFailure = 'invalid-account' | 'wrong-token' | 'unavailable'

// Caught here before anything is sent, so it never comes back from the server.
type SetupFormError = SetupFailure | 'password-mismatch'

const ERROR_MESSAGES: Record<SetupFormError, string> = {
  'password-mismatch': "The passwords don't match.",
  'invalid-account':
    `Enter a username, and a password of ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_BYTES} characters. ` +
    'Accented letters and emoji count as two or more.',
  'wrong-token': "That setup token doesn't match. Copy the latest one from the server logs; it changes on every restart.",
  unavailable: "Couldn't reach Continuarr. Try again in a moment.",
}

export interface SetupFormProps {
  submitting: boolean
  failure: SetupFailure | undefined
  onSubmit: (request: SetupRequest) => void
}

export function SetupForm({ submitting, failure, onSubmit }: SetupFormProps) {
  const errorId = useId()
  const [passwordsDiffer, setPasswordsDiffer] = useState(false)
  const error: SetupFormError | undefined = passwordsDiffer ? 'password-mismatch' : failure
  const describedBy = error ? errorId : undefined

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const form = new FormData(event.currentTarget)
    const password = textField(form, 'password')
    const differ = password !== textField(form, 'confirmPassword')
    setPasswordsDiffer(differ)
    if (differ) return
    onSubmit({
      // Copying from a terminal often picks up surrounding whitespace, which no token contains.
      token: textField(form, 'token').trim(),
      username: textField(form, 'username'),
      password,
    })
  }

  return (
    <form onSubmit={handleSubmit} className={FORM_CLASSES}>
      <h1 className={HEADING_CLASSES}>Set up Continuarr</h1>
      <p className="mt-2 text-sm text-ink-400">
        Create the admin account. The setup token is printed in the server logs.
      </p>

      <FormAlert id={errorId}>{error && ERROR_MESSAGES[error]}</FormAlert>

      <div className="mt-6 space-y-5">
        <label className={LABEL_CLASSES}>
          Setup token
          <input
            name="token"
            autoComplete="off"
            spellCheck={false}
            required
            aria-invalid={error === 'wrong-token'}
            aria-describedby={describedBy}
            className={`${FIELD_CLASSES} font-mono`}
          />
        </label>
        <label className={LABEL_CLASSES}>
          Username
          <input
            name="username"
            autoComplete="username"
            required
            aria-invalid={error === 'invalid-account'}
            aria-describedby={describedBy}
            className={FIELD_CLASSES}
          />
        </label>
        <label className={LABEL_CLASSES}>
          Password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            aria-invalid={error === 'invalid-account'}
            aria-describedby={describedBy}
            className={FIELD_CLASSES}
          />
        </label>
        <label className={LABEL_CLASSES}>
          Confirm password
          <input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={error === 'invalid-account' || error === 'password-mismatch'}
            aria-describedby={describedBy}
            className={FIELD_CLASSES}
          />
        </label>

        <SubmitButton submitting={submitting} label="Create admin" submittingLabel="Creating admin…" />
      </div>
    </form>
  )
}
