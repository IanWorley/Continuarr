# User guide

How to use Continuarr: one concise section per major feature, plus how to run an installed Continuarr server. See [Documentation in `AGENTS.md`](../../AGENTS.md#documentation) before you add a page.

## Media servers

Continuarr reads watch history from Jellyfin and Plex. Connect them under **Settings › Media servers**.

- A server you haven't connected has no card. Choose it from **Add server** to get one. The card goes away if you leave the page before you save.
- Each card saves on its own. **Reload** shows what's saved, and asks first if a card has changes you haven't saved.
- **Unlink** on the Plex card makes Continuarr forget the Plex server and its token. Linking through plex.tv isn't available yet, so for now a Plex server comes from `CONTINUARR_PLEX_URL` and `CONTINUARR_PLEX_TOKEN`.
