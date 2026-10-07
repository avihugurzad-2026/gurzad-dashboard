-- Migration 0001: Schema
-- Run FIRST. All tables use CREATE TABLE IF NOT EXISTS — no data is dropped.
--
-- PRE-FLIGHT (run in SQL Editor before this migration):
--   SELECT tablename FROM pg_tables WHERE schemaname='public';
-- If any of these names appear — parameters, branches, entities, tasks,
-- sync_runs, entity_history — STOP and contact the developer before proceeding.

CREATE TABLE IF NOT EXISTS parameters (
  key             text  NOT NULL,
  effective_from  date  NOT NULL,
  value           jsonb NOT NULL,
  source          text,
  confidence      text,
  PRIMARY KEY (key, effective_from)
);

CREATE TABLE IF NOT EXISTS branches (
  domain    text NOT NULL,
  branch    text NOT NULL,
  name_he   text,
  sort      int,
  PRIMARY KEY (domain, branch)
);

CREATE TABLE IF NOT EXISTS entities (
  id            text        PRIMARY KEY,
  type          text        NOT NULL,
  domain        text        NOT NULL,
  branch        text        NOT NULL,
  status        text,
  data          jsonb,
  source_path   text,
  content_hash  text,
  updated_at    timestamptz,
  synced_at     timestamptz,
  deleted_at    timestamptz
);

CREATE TABLE IF NOT EXISTS tasks (
  id          text    PRIMARY KEY,
  domain      text    NOT NULL,
  branch      text    NOT NULL,
  text        text    NOT NULL,
  priority    text,
  due         date,
  done        bool    DEFAULT false,
  source_path text,
  deleted_at  timestamptz
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id            bigserial   PRIMARY KEY,
  started_at    timestamptz DEFAULT now(),
  finished_at   timestamptz,
  mode          text,
  added         int         DEFAULT 0,
  changed       int         DEFAULT 0,
  soft_deleted  int         DEFAULT 0,
  errors        jsonb,
  dry_run       bool        DEFAULT true
);

CREATE TABLE IF NOT EXISTS entity_history (
  entity_id   text        NOT NULL,
  changed_at  timestamptz DEFAULT now(),
  old         jsonb,
  new         jsonb
);

CREATE INDEX IF NOT EXISTS idx_entities_domain_branch
  ON entities (domain, branch) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_entities_type
  ON entities (type) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_active
  ON tasks (done, due) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_entity_history_entity
  ON entity_history (entity_id, changed_at);
