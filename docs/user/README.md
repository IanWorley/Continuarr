# User guide

How to use Continuarr: one concise section per major feature, plus how to run an installed Continuarr server. See [Documentation in `AGENTS.md`](../../AGENTS.md#documentation) before you add a page.

## Back up the encryption key

Continuarr encrypts the secrets you save, such as the Jellyfin API key. Unless you set `CONTINUARR_ENCRYPTION_KEY`, it creates the key on first start in the `continuarr-data` volume and reuses it after that. Back up that volume whenever you back up the database. If the database holds secrets but the volume has no key, Continuarr stops at startup with an error instead of making a new key, because a new key can't read the old secrets. Restore the volume, or set `CONTINUARR_ENCRYPTION_KEY` to the old key, and start again.
