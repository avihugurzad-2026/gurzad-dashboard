-- Migration: external revenue sources (Buyz for Head Spa Israel). Only creates new tables
-- and inserts new rows; nothing existing is altered or dropped.
--
-- Hierarchy: domain (business / personal / ventures) → branch (adigital, head-spa-israel, …)
-- → location (a spa: Modiin, Jerusalem, …). A new spa = one `locations` row, no schema change.
-- One Buyz supplier account = one location (revenue_sources). A location may have no source yet.

CREATE TABLE IF NOT EXISTS locations (
  domain    text    NOT NULL,
  branch    text    NOT NULL,
  location  text    NOT NULL,
  name_he   text    NOT NULL,
  active    boolean NOT NULL DEFAULT true,
  sort      int,
  PRIMARY KEY (branch, location),
  FOREIGN KEY (domain, branch) REFERENCES branches (domain, branch)
);

CREATE TABLE IF NOT EXISTS revenue_sources (
  source          text    NOT NULL,                 -- 'buyz'
  source_account  text    NOT NULL,                 -- Buyz supplier.id
  domain          text    NOT NULL,
  branch          text    NOT NULL,
  location        text    NOT NULL,                 -- 'modiin'
  name_he         text    NOT NULL,
  amounts_include_vat boolean NOT NULL,             -- confirmed by avihu 2026-10-07 for Buyz
  active          boolean NOT NULL DEFAULT true,
  PRIMARY KEY (source, source_account),
  FOREIGN KEY (domain, branch) REFERENCES branches (domain, branch),
  FOREIGN KEY (branch, location) REFERENCES locations (branch, location)
);

-- Monthly revenue per location, as reported by the source (incl. VAT for Buyz).
-- No row = no data. A month is updated in place when the source changes it; the
-- previous values go to revenue_monthly_history.
CREATE TABLE IF NOT EXISTS revenue_monthly (
  source          text          NOT NULL,
  source_account  text          NOT NULL,
  month           date          NOT NULL,           -- first day of the month
  revenue_total   numeric(14,2) NOT NULL,
  tx_count        int,
  bookings        numeric(14,2),
  vouchers        numeric(14,2),
  sales           numeric(14,2),
  fetched_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_account, month),
  FOREIGN KEY (source, source_account) REFERENCES revenue_sources (source, source_account)
);

CREATE TABLE IF NOT EXISTS revenue_monthly_history (
  id              bigserial     PRIMARY KEY,
  source          text          NOT NULL,
  source_account  text          NOT NULL,
  month           date          NOT NULL,
  revenue_total   numeric(14,2),
  tx_count        int,
  bookings        numeric(14,2),
  vouchers        numeric(14,2),
  sales           numeric(14,2),
  replaced_at     timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE locations               ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_sources         ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_monthly         ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_monthly_history ENABLE ROW LEVEL SECURITY;

INSERT INTO locations (domain, branch, location, name_he, sort) VALUES
  ('business', 'head-spa-israel', 'modiin',    'מודיעין', 1),
  ('business', 'head-spa-israel', 'jerusalem', 'ירושלים', 2)   -- no activity yet, no Buyz account
ON CONFLICT DO NOTHING;

INSERT INTO revenue_sources (source, source_account, domain, branch, location, name_he, amounts_include_vat)
VALUES ('buyz', '1', 'business', 'head-spa-israel', 'modiin', 'ספא ראש מודיעין', true)
ON CONFLICT DO NOTHING;

-- avihu's share of the business (spec §2 decision 6). A dated parameter, never a constant in code.
INSERT INTO parameters (key, effective_from, value, source, confidence) VALUES
  ('ownership_pct:head-spa-israel', '2000-01-01', '{"pct": 0.5}', 'spec:BUILD-SPEC §2 decision 6', 'fact')
ON CONFLICT DO NOTHING;
