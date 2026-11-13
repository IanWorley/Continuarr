--liquibase formatted sql

-- The admin's Plex server. The CHECK on id allows a single row. The token is AES-GCM ciphertext under
-- CONTINUARR_ENCRYPTION_KEY, with its IV inside the same bytes. source says how the row got here: ENVIRONMENT
-- rows come from CONTINUARR_PLEX_URL and CONTINUARR_PLEX_TOKEN at startup, and PLEX_TV rows from signing in
-- through plex.tv, which a startup seed never overwrites.

--changeset ianworley:0004-plex-connection
CREATE TABLE plex_connection
(
  id               SMALLINT NOT NULL CHECK (id = 1),
  url              TEXT NOT NULL,
  token_ciphertext BYTEA NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('ENVIRONMENT', 'PLEX_TV')),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
--rollback DROP TABLE plex_connection;
