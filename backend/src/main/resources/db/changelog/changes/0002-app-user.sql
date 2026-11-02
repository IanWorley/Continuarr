--liquibase formatted sql

-- Login accounts, mapped by the User entity. v1 has a single admin, created through first-run
-- setup: the unique index on a constant allows at most one row, so racing setup requests can't
-- create two.

--changeset ianworley:0002-app-user
CREATE TABLE app_user
(
  id            BIGINT GENERATED ALWAYS AS IDENTITY,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE UNIQUE INDEX app_user_single_row_idx ON app_user ((true));
--rollback DROP TABLE app_user;
