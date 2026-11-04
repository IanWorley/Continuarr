--liquibase formatted sql

-- The Jellyfin server the admin saves in the app. The CHECK on id allows a single row, which each save
-- replaces with an upsert. The API key is AES-GCM ciphertext under CONTINUARR_ENCRYPTION_KEY, with its
-- IV inside the same bytes.

--changeset ianworley:0003-jellyfin-connection
CREATE TABLE jellyfin_connection
(
  id                 SMALLINT NOT NULL CHECK (id = 1),
  url                TEXT NOT NULL,
  api_key_ciphertext BYTEA NOT NULL,
  updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
--rollback DROP TABLE jellyfin_connection;
