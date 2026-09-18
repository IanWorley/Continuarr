# Issue 60: Plex owner connection

Status: proposed design; implementation has not started.

## Intended flow

Replace the Plex test page with a Connections page protected by the existing
Continuarr administrator session. Continuarr sign-in and Plex authorization are
separate identities. Confirm this interpretation with Ian before implementation.

1. The administrator signs into Continuarr and opens Connections.
2. Connect Plex starts a stored authorization attempt and opens Plex authorization
   in a new tab. The Connections page displays the pending state.
3. The backend checks the PIN, reads the authenticated Plex account, and discovers
   accessible Plex Media Servers using stable machine identifiers.
4. The administrator selects one server. The backend saves its owner credential
   using encrypted storage and returns only safe account and server details.
5. The page displays the connected account, server, and connection status.

## Implementation boundaries

- Reuse existing administrator login and page protection; enforce authorization
  on every connection API as well.
- Build on connection persistence (#58) and stored, session-bound PIN attempts
  (#59). Check their current merge status before starting implementation.
- Use protected state-changing requests for starting, cancelling, and completing
  authorization. Keep all Plex tokens on the backend.
- Model pending, expired, cancelled, unavailable, and replayed attempts explicitly.
  Prevent cross-session completion and duplicate consumption of an attempt.
- Use the existing typed API, repository, and encrypted credential storage
  patterns, with named constants for polling intervals and expiry values.
- Include the Plex portion of the Connections UI proposed in #66. Jellyfin,
  Plex Home identities, and the remainder of #66 remain separate work.

## Verification

Add focused service and API tests for authorization transitions, administrator
and session enforcement, server selection, encrypted persistence, and exclusion
of credentials from responses. Add focused UI tests for pending, expiry, failure,
and successful selection. Run the repository typecheck, lint, relevant tests,
and production build, then manually verify the browser flow.

## Remaining design decision

Confirm that administrator-first means a separate Continuarr login before Plex
connection. This document records the proposed scope, not an approved or completed
implementation.
