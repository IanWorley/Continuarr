import type { ReactNode } from 'react'

export const FORM_CLASSES = 'w-full max-w-sm lg:max-w-md'
export const HEADING_CLASSES = 'text-2xl font-semibold text-ink-100'
export const LABEL_CLASSES = 'block text-sm font-medium text-ink-100'
export const FIELD_CLASSES =
  'mt-2 block w-full rounded-md border border-ink-500 bg-ink-950 px-3.5 py-2.5 text-ink-100 placeholder:text-ink-400 ' +
  'outline-hidden transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/50 ' +
  'aria-invalid:border-danger/70'

/** Announces a failed submit. Always mounted so screen readers are already watching it when a message appears. */
export function FormAlert({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div aria-live="polite" id={id}>
      {children && (
        <p className="mt-6 flex items-center gap-2 rounded-md border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-sm text-danger">
          <span aria-hidden="true" className="font-bold">!</span>
          <span>{children}</span>
        </p>
      )}
    </div>
  )
}

export interface SubmitButtonProps {
  submitting: boolean
  label: string
  submittingLabel: string
}

export function SubmitButton({ submitting, label, submittingLabel }: SubmitButtonProps) {
  return (
    // aria-disabled rather than disabled, so a keyboard user's focus stays on the button.
    <button
      type="submit"
      aria-disabled={submitting}
      className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 font-semibold text-accent-ink transition not-aria-disabled:hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-wait aria-disabled:opacity-85"
    >
      {submitting && <Spinner />}
      {submitting ? submittingLabel : label}
    </button>
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
