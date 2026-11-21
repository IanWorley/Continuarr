import type { ReactNode } from 'react'
import { Icon, type IconName } from '../shell/Icon.tsx'

export const FORM_CLASSES = 'w-full max-w-sm lg:max-w-md'
export const HEADING_CLASSES = 'text-2xl font-semibold text-ink-100'
export const LABEL_CLASSES = 'block text-sm font-medium text-ink-100'
// The look every text field shares. Each form adds its own size and spacing.
const FIELD_SURFACE =
  'rounded-md border border-ink-500 bg-ink-950 text-ink-100 placeholder:text-ink-400 outline-hidden transition ' +
  'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/50 aria-invalid:border-danger/70'
export const FIELD_CLASSES = `mt-2 block w-full px-3.5 py-2.5 ${FIELD_SURFACE}`
// Settings fields: 36px tall, 44px on phones. Text stays 16px, so iOS doesn't zoom into a focused field.
export const COMPACT_FIELD_CLASSES =
  `block h-touch w-full px-3.5 text-base tablet:h-control ${FIELD_SURFACE} ` +
  'aria-invalid:focus-visible:border-accent read-only:bg-ink-850 read-only:text-ink-400'

const BUTTON_BASE =
  'inline-flex h-touch items-center justify-center gap-1.5 rounded-md border px-3 font-medium whitespace-nowrap transition ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent tablet:h-control'
// aria-disabled rather than disabled on settings buttons, so a keyboard user's focus stays where it was.
export const PRIMARY_BUTTON_CLASSES =
  `${BUTTON_BASE} border-accent bg-accent font-semibold text-accent-ink ` +
  'not-aria-disabled:hover:border-accent-hover not-aria-disabled:hover:bg-accent-hover'
export const SECONDARY_BUTTON_CLASSES = `${BUTTON_BASE} border-ink-500 text-ink-100 not-aria-disabled:hover:border-ink-400`
export const DANGER_BUTTON_CLASSES = `${BUTTON_BASE} border-danger/50 text-danger not-aria-disabled:hover:border-danger`
export const UNAVAILABLE_BUTTON_CLASSES = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-55'
export const BUSY_BUTTON_CLASSES = 'cursor-wait opacity-85'

export type BannerTone = 'danger' | 'warn'

const BANNER_TONES: Record<BannerTone, { classes: string; icon: IconName }> = {
  danger: { classes: 'border-danger/30 bg-danger-surface text-danger', icon: 'alert' },
  warn: { classes: 'border-warn/30 bg-warn-surface text-warn', icon: 'warn' },
}

export interface BannerProps {
  tone: BannerTone
  title: string
  children: ReactNode
  action?: ReactNode
}

/** A titled alert with an optional action, for problems that stop a whole form rather than one field. */
export function Banner({ tone, title, children, action }: BannerProps) {
  const { classes, icon } = BANNER_TONES[tone]
  return (
    <div className={`flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-md border px-3.5 py-2.5 ${classes}`}>
      <Icon name={icon} className="mt-0.5 size-4" />
      <div className="min-w-0 flex-[1_1_15rem]">
        <p className="font-semibold">{title}</p>
        <p>{children}</p>
      </div>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  )
}

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

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-4 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink"
    />
  )
}
