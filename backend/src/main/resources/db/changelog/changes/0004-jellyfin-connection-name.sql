--liquibase formatted sql

-- A name the admin gives the Jellyfin connection, shown on its settings card. Null shows the default.

--changeset ianworley:0004-jellyfin-connection-name
ALTER TABLE jellyfin_connection ADD COLUMN name TEXT;
--rollback ALTER TABLE jellyfin_connection DROP COLUMN name;
