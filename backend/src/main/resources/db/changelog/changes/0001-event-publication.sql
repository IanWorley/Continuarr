--liquibase formatted sql

-- Spring Modulith Event Publication Registry, v2 schema for Postgres.
-- Mirrors schemas/v2/schema-postgresql.sql from spring-modulith-events-jdbc 2.1.1;
-- re-check it against that file when upgrading Modulith.

--changeset ianworley:0001-event-publication
CREATE TABLE event_publication
(
  id                     UUID NOT NULL,
  listener_id            TEXT NOT NULL,
  event_type             TEXT NOT NULL,
  serialized_event       TEXT NOT NULL,
  publication_date       TIMESTAMP WITH TIME ZONE NOT NULL,
  completion_date        TIMESTAMP WITH TIME ZONE,
  status                 TEXT,
  completion_attempts    INT,
  last_resubmission_date TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (id)
);
CREATE INDEX event_publication_serialized_event_hash_idx ON event_publication USING hash (serialized_event);
CREATE INDEX event_publication_by_completion_date_idx ON event_publication (completion_date);
--rollback DROP TABLE event_publication;
