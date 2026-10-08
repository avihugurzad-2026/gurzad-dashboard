-- Migration 0005: kpi_snapshots + alerts (DASHBOARD-SPEC-v2 §3, stage 0+)
-- Run AFTER 20261007132734_entity_history_add_primary_key. Only creates new tables; nothing existing is altered or dropped.

-- Weekly KPI history for trends/sparklines. Written by `sync --apply` only.
-- Group-wide KPIs use domain/branch '_all' so the unique key has no NULLs.
CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id         bigserial   PRIMARY KEY,
  taken_at   timestamptz NOT NULL DEFAULT now(),
  period     text        NOT NULL,             -- 'YYYY-Www' or 'YYYY-MM'
  kpi_key    text        NOT NULL,
  domain     text        NOT NULL,
  branch     text        NOT NULL,
  value      numeric     NOT NULL,             -- no row = no data (never stored as 0)
  basis      text        NOT NULL CHECK (basis IN ('group_100', 'my_share', 'n/a')),
  vat_basis  text        NOT NULL CHECK (vat_basis IN ('ex_vat', 'incl_vat', 'n/a')),
  UNIQUE (period, kpi_key, domain, branch, basis)
);

CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_series
  ON kpi_snapshots (kpi_key, domain, branch, basis, period);

-- Persistent alerts. alert_key = rule_id + subject, so the same breach is one row
-- that only gets last_seen updated; when it disappears resolved_at is set.
CREATE TABLE IF NOT EXISTS alerts (
  id               bigserial   PRIMARY KEY,
  alert_key        text        NOT NULL,
  rule_id          text        NOT NULL,
  severity         text        NOT NULL CHECK (severity IN ('red', 'orange')),
  level            text        NOT NULL DEFAULT 'critical'
                               CHECK (level IN ('warning', 'critical', 'breach')),
  entity_id        text,
  domain           text,
  branch           text,
  title            text        NOT NULL,
  amount           numeric,
  days             int,
  counterparty     text,
  suggested_action text,
  owner            text,
  first_seen       timestamptz NOT NULL DEFAULT now(),
  last_seen        timestamptz NOT NULL DEFAULT now(),
  snoozed_until    date,
  resolved_at      timestamptz
);

-- At most one open alert per breach
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_open
  ON alerts (alert_key) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_open_severity
  ON alerts (severity, first_seen) WHERE resolved_at IS NULL;

-- Same policy as the other tables: RLS on, no policies. The server reads with
-- its own Postgres role; the public/anon key sees nothing.
ALTER TABLE kpi_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts        ENABLE ROW LEVEL SECURITY;
