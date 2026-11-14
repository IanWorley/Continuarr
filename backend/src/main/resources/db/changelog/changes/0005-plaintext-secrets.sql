--liquibase formatted sql

-- Stores the Jellyfin API key and the Plex token as plain text, replacing the AES-GCM ciphertext that 0003 and 0004
-- kept under CONTINUARR_ENCRYPTION_KEY. Continuarr no longer reads that key, so the ciphertext can't be decrypted and
-- is dropped. Each URL stays, and a row with no secret reads as not saved until the admin saves it again.

--changeset ianworley:0005-plaintext-secrets
ALTER TABLE jellyfin_connection DROP COLUMN api_key_ciphertext;
ALTER TABLE jellyfin_connection ADD COLUMN api_key TEXT;
ALTER TABLE plex_connection DROP COLUMN token_ciphertext;
ALTER TABLE plex_connection ADD COLUMN token TEXT;
--rollback DELETE FROM jellyfin_connection;
--rollback ALTER TABLE jellyfin_connection DROP COLUMN api_key;
--rollback ALTER TABLE jellyfin_connection ADD COLUMN api_key_ciphertext BYTEA NOT NULL;
--rollback DELETE FROM plex_connection;
--rollback ALTER TABLE plex_connection DROP COLUMN token;
--rollback ALTER TABLE plex_connection ADD COLUMN token_ciphertext BYTEA NOT NULL;
