import type { ReactNode } from 'react'
import { Icon } from '../shell/Icon.tsx'

// Pieces every media server card shares: the saved-state pill, the section title, and labelled field rows.

export type PillTone = 'ok' | 'off' | 'warn'

const PILL_TONES: Record<PillTone, string> = {
  ok: 'border-ok/30 bg-ok-surface text-ok',
  off: 'border-ink-500 bg-ink-800 text-ink-400',
  warn: 'border-warn/30 bg-warn-surface text-warn',
}

export const SMALL_TEXT = 'text-help tablet:text-xs'
export const ROW = 'grid gap-x-3 gap-y-1 py-1 tablet:grid-cols-[var(--spacing-label)_minmax(0,1fr)] tablet:py-1.5'
export const ROW_LABEL = 'font-medium tablet:pt-2 tablet:text-right'

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.25 py-0.5 text-xs font-semibold whitespace-nowrap before:size-1.5 before:rounded-full before:bg-current tablet:text-pill ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="px-3.5 pt-2.5 pb-1 text-xs font-semibold tracking-wider text-ink-400 uppercase tablet:text-section">
      {children}
    </p>
  )
}

interface FieldRowProps {
  label: string
  inputId: string
  error: string | undefined
  hints: ReactNode
  children: ReactNode
}

export function FieldRow({ label, inputId, error, hints, children }: FieldRowProps) {
  return (
    <div data-field-row className={ROW}>
      <label htmlFor={inputId} className={ROW_LABEL}>
        {label}
      </label>
      <div className="flex min-w-0 flex-col gap-1.25">
        {children}
        {error && (
          <p id={`${inputId}-error`} className={`flex items-start gap-1.5 font-medium text-danger ${SMALL_TEXT}`}>
            <Icon name="alert" className="mt-0.5 size-3.5" />
            {error}
          </p>
        )}
        {hints}
      </div>
    </div>
  )
}
