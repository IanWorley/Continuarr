--liquibase formatted sql

-- The single admin, created through first-run setup. The id is pinned to 1 so a second
-- admin can never be inserted, even if two setup requests race.

--changeset ianworley:0002-admin-account
CREATE TABLE admin_account
(
  id            SMALLINT NOT NULL DEFAULT 1 CHECK (id = 1),
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
--rollback DROP TABLE admin_account;
