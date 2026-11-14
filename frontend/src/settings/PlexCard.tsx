import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { unlinkPlex, type PlexConnection } from '../api/client.ts'
import {
  Banner,
  BUSY_BUTTON_CLASSES,
  COMPACT_FIELD_CLASSES,
  DANGER_BUTTON_CLASSES,
  PRIMARY_BUTTON_CLASSES,
  SECONDARY_BUTTON_CLASSES,
  Spinner,
  UNAVAILABLE_BUTTON_CLASSES,
} from '../auth/formParts.tsx'
import { Icon } from '../shell/Icon.tsx'
import { LaterTag } from '../shell/LaterTag.tsx'
import { CardHead, ComingLater, FieldRow, Pill, ROW, ROW_LABEL, SectionTitle, SMALL_TEXT, type PillTone } from './cardParts.tsx'
import { focusOnMount } from './focus.ts'
import { plexConnectionQuery } from './servers.ts'

const NOTHING_SAVED: PlexConnection = { url: null, source: null, tokenState: 'NONE' }
const LINK_LATER = 'Linking through plex.tv comes in a later release.'

/** A saved URL with no token is a link that needs renewing, such as one saved before secrets were stored as text. */
type LinkState = 'notLinked' | 'linked' | 'expired'

function linkState(saved: PlexConnection): LinkState {
  if (!saved.url) return 'notLinked'
  return saved.tokenState === 'STORED' ? 'linked' : 'expired'
}

const PILLS: Record<LinkState, { tone: PillTone; text: string }> = {
  notLinked: { tone: 'off', text: 'Not linked' },
  linked: { tone: 'ok', text: 'Linked' },
  expired: { tone: 'warn', text: 'Re-link needed' },
}

/** Where Unlink is, from the inline confirm to what the last attempt left to say. */
type Outcome = 'confirming' | 'unlinking' | 'unlinked' | 'failed'

export function PlexCard({ onUnlinked }: { onUnlinked?: () => void }) {
  const titleId = useId()
  // The page loads this too, and remounts the card after a reload it has already fetched.
  const query = useQuery({ ...plexConnectionQuery, refetchOnMount: false })

  return (
    <section aria-labelledby={titleId} className="min-w-0 rounded-lg border border-ink-700 bg-ink-900">
      {query.data ? (
        <PlexLink titleId={titleId} saved={query.data} onUnlinked={onUnlinked} />
      ) : query.isError ? (
        <>
          <CardHead kind="plex" titleId={titleId} meta="Settings not loaded" pill={<Pill tone="warn">Unknown</Pill>} />
          <div role="alert" className="m-3.5">
            <Banner
              tone="danger"
              title="Couldn't load settings."
              action={
                <button
                  type="button"
                  aria-disabled={query.isFetching}
                  onClick={() => void query.refetch()}
                  className={SECONDARY_BUTTON_CLASSES}
                >
                  Retry
                </button>
              }
            >
              Retry before you change anything here.
            </Banner>
          </div>
        </>
      ) : (
        <>
          <CardHead kind="plex" titleId={titleId} meta="Loading…" />
          <div aria-busy="true" className="px-3.5 py-2.5">
            <span className="block h-3 w-3/5 rounded-sm bg-ink-800 motion-safe:animate-pulse" />
          </div>
        </>
      )}
    </section>
  )
}

interface PlexLinkProps {
  titleId: string
  saved: PlexConnection
  onUnlinked: (() => void) | undefined
}

function PlexLink({ titleId, saved, onUnlinked }: PlexLinkProps) {
  const queryClient = useQueryClient()
  const ids = { server: useId(), serverHelp: useId(), later: useId(), confirm: useId() }
  const [outcome, setOutcome] = useState<Outcome>()
  const refocusUnlink = useRef(false)
  const state = linkState(saved)
  const pill = PILLS[state]
  const seeded = saved.source === 'ENVIRONMENT'

  async function unlink() {
    if (outcome === 'unlinking') return
    setOutcome('unlinking')
    const response = await unlinkPlex().catch(() => undefined)
    if (response?.ok) {
      // First, so the page keeps this card once the cache says nothing is saved.
      onUnlinked?.()
      await queryClient.cancelQueries({ queryKey: plexConnectionQuery.queryKey })
      queryClient.setQueryData(plexConnectionQuery.queryKey, NOTHING_SAVED)
      setOutcome('unlinked')
      // The confirm that held focus is gone, so focus lands on the card rather than the page.
      document.getElementById(titleId)?.focus()
    } else {
      setOutcome('failed')
    }
  }

  const account =
    state === 'notLinked'
      ? 'No Plex account is linked yet.'
      : seeded
        ? 'Seeded from CONTINUARR_PLEX_URL and CONTINUARR_PLEX_TOKEN.'
        : 'Linked through plex.tv.'
  const linkLabel = state === 'notLinked' ? 'Link with plex.tv' : state === 'expired' ? 'Re-link with plex.tv' : 'Re-link'
  const linkClasses = state === 'linked' ? SECONDARY_BUTTON_CLASSES : PRIMARY_BUTTON_CLASSES

  return (
    <>
      <CardHead
        kind="plex"
        titleId={titleId}
        meta={saved.url ?? 'Not linked yet'}
        pill={<Pill tone={pill.tone}>{pill.text}</Pill>}
      />
      <div aria-live="polite">
        {state === 'expired' && (
          <div className="mx-3.5 mt-2.5">
            <Banner tone="warn" title="Your Plex link expired.">
              Continuarr has no token for this server anymore, so it can't read from Plex. Re-link with plex.tv to
              fix it.
            </Banner>
          </div>
        )}
        {outcome === 'failed' && (
          <div className="mx-3.5 mt-2.5">
            <Banner
              tone="danger"
              title="Couldn't unlink Plex."
              action={
                <button type="button" onClick={() => void unlink()} className={SECONDARY_BUTTON_CLASSES}>
                  Try again
                </button>
              }
            >
              The link is unchanged.
            </Banner>
          </div>
        )}
      </div>
      <SectionTitle>Account</SectionTitle>
      <div className="px-3.5 pt-1.5 pb-2.5">
        <div className={ROW}>
          <span className={ROW_LABEL}>plex.tv</span>
          <p className={`flex items-start gap-1.5 tablet:pt-2 ${state === 'linked' ? 'text-ink-100' : 'text-ink-400'}`}>
            <Icon name={state === 'linked' ? 'lock' : 'unlock'} className="mt-0.5 size-3.75" />
            {account}
          </p>
        </div>
        <FieldRow
          label="Server"
          inputId={ids.server}
          error={undefined}
          hints={
            <p id={ids.serverHelp} className={`flex items-center gap-2 text-ink-400 ${SMALL_TEXT}`}>
              <LaterTag />
              Choosing a server from your account comes with plex.tv linking.
            </p>
          }
        >
          <select
            id={ids.server}
            disabled
            aria-describedby={ids.serverHelp}
            className={`${COMPACT_FIELD_CLASSES} cursor-not-allowed bg-ink-850 text-ink-400`}
          >
            <option>{saved.url ?? 'No servers yet'}</option>
          </select>
        </FieldRow>
      </div>
      <ComingLater kind="plex" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-b-lg border-t border-ink-700 bg-ink-850 px-3.5 py-2.5">
        {outcome === 'confirming' || outcome === 'unlinking' ? (
          <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
            <p id={ids.confirm} className={`min-w-0 flex-[1_1_14rem] ${SMALL_TEXT}`}>
              <span className="font-semibold">Unlink Plex?</span> Continuarr forgets this server and its token.
              {seeded && ' It comes back on the next start while the env vars are set.'}
            </p>
            <div className="flex w-full gap-2 tablet:ml-auto tablet:w-auto">
              <button
                type="button"
                ref={focusOnMount}
                onClick={() => {
                  refocusUnlink.current = true
                  setOutcome(undefined)
                }}
                className={`flex-1 ${SECONDARY_BUTTON_CLASSES}`}
              >
                Cancel
              </button>
              <button
                type="button"
                aria-disabled={outcome === 'unlinking'}
                aria-describedby={ids.confirm}
                onClick={() => void unlink()}
                className={`flex-1 ${DANGER_BUTTON_CLASSES} ${outcome === 'unlinking' ? BUSY_BUTTON_CLASSES : ''}`}
              >
                {outcome === 'unlinking' && <Spinner />}
                {outcome === 'unlinking' ? 'Unlinking…' : 'Unlink'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={`flex min-w-0 flex-col gap-1 ${SMALL_TEXT}`}>
              <output>
                {outcome === 'unlinked' && (
                  <p className="flex items-center gap-1.5 font-semibold text-ok">
                    <Icon name="check" className="size-3.75" />
                    Unlinked. Continuarr no longer reads from this server.
                  </p>
                )}
              </output>
              <p id={ids.later} className="flex items-center gap-2 text-ink-400">
                <LaterTag />
                {LINK_LATER}
              </p>
            </div>
            <div className="flex w-full gap-2 tablet:ml-auto tablet:w-auto">
              {state !== 'notLinked' && (
                <button
                  type="button"
                  ref={(button) => {
                    if (button && refocusUnlink.current) {
                      refocusUnlink.current = false
                      button.focus()
                    }
                  }}
                  onClick={() => setOutcome('confirming')}
                  className={`flex-1 ${DANGER_BUTTON_CLASSES}`}
                >
                  Unlink
                </button>
              )}
              <button
                type="button"
                aria-disabled="true"
                aria-describedby={ids.later}
                className={`flex-1 ${linkClasses} ${UNAVAILABLE_BUTTON_CLASSES}`}
              >
                <Icon name="link" className="size-3.75" />
                {linkLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
