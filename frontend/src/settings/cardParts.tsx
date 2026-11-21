import { useId, type ReactNode } from 'react'
import { Icon } from '../shell/Icon.tsx'
import { LaterTag } from '../shell/LaterTag.tsx'
import { SERVER_NAMES, type ServerKind } from './servers.ts'

// Pieces every media server card shares: the head, the saved-state pill, the section title, labelled field
// rows, and the dimmed zone for what comes with sync.

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

const MARK_COLORS: Record<ServerKind, string> = { jellyfin: 'text-jellyfin', plex: 'text-plex' }

interface CardHeadProps {
  kind: ServerKind
  titleId: string
  meta: ReactNode
  pill?: ReactNode
}

/** The head every card state shares, loading included, so the page doesn't jump. */
export function CardHead({ kind, titleId, meta, pill }: CardHeadProps) {
  const name = SERVER_NAMES[kind]
  return (
    <div className="flex items-center gap-2.5 border-b border-ink-700 px-3.5 py-3">
      <span
        aria-hidden="true"
        className={`grid size-7 flex-none place-items-center rounded-md border border-ink-700 bg-ink-800 font-extrabold ${MARK_COLORS[kind]}`}
      >
        {name[0]}
      </span>
      <div className="min-w-0 flex-1">
        {/* Focusable from script only, so the page can move focus to a card it just added. */}
        <h2 id={titleId} tabIndex={-1} className="text-card-title font-semibold outline-none">
          {name}
        </h2>
        <p className={`wrap-anywhere text-ink-400 ${SMALL_TEXT}`}>{meta}</p>
      </div>
      {pill}
    </div>
  )
}

export function SectionTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p
      id={id}
      className="flex items-center gap-2 px-3.5 pt-2.5 pb-1 text-xs font-semibold tracking-wider text-ink-400 uppercase tablet:text-section"
    >
      {children}
    </p>
  )
}

const LATER_STATS = ['Users', 'Libraries', 'Last sync']

/** v9's preview of what sync will add to a card. Dimmed, and nothing in it responds. */
export function ComingLater({ kind }: { kind: ServerKind }) {
  const titleId = useId()
  return (
    <fieldset
      disabled
      aria-disabled="true"
      aria-labelledby={titleId}
      className="min-w-0 cursor-not-allowed border-t border-dashed border-ink-700 opacity-55 select-none"
    >
      <SectionTitle id={titleId}>
        Sync <LaterTag />
      </SectionTitle>
      <div className="px-3.5 pt-1 pb-2.5">
        <div className={ROW}>
          <span className={ROW_LABEL}>Sync</span>
          <span className="flex items-center gap-2.5 tablet:pt-2">
            <span
              role="switch"
              aria-checked="false"
              aria-disabled="true"
              aria-label={`Sync watch history from ${SERVER_NAMES[kind]}`}
              className="relative h-5 w-9 flex-none rounded-full border border-ink-500 bg-ink-800 before:absolute before:top-0.5 before:left-0.5 before:size-3.5 before:rounded-full before:bg-ink-400"
            />
            <span className="text-ink-400">Off</span>
          </span>
        </div>
        <dl className={ROW}>
          <dt className={ROW_LABEL}>Stats</dt>
          <dd className="flex flex-wrap gap-x-4 gap-y-1 text-ink-400 tablet:pt-2">
            {LATER_STATS.map((stat) => (
              <span key={stat}>
                {stat} <span className="font-semibold text-ink-100">—</span>
              </span>
            ))}
          </dd>
        </dl>
      </div>
    </fieldset>
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
