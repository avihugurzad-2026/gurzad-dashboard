-- Migration: external revenue sources (Buyz for Head Spa Israel). Only creates new tables
-- and inserts new rows; nothing existing is altered or dropped.
--
-- Hierarchy: business (domain) → head-spa-israel (branch) → location (a spa, e.g. Modiin).
-- One Buyz supplier account = one location. A new spa = one more revenue_sources row.

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
  FOREIGN KEY (domain, branch) REFERENCES branches (domain, branch)
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

ALTER TABLE revenue_sources         ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_monthly         ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_monthly_history ENABLE ROW LEVEL SECURITY;

INSERT INTO revenue_sources (source, source_account, domain, branch, location, name_he, amounts_include_vat)
VALUES ('buyz', '1', 'business', 'head-spa-israel', 'modiin', 'ספא ראש מודיעין', true)
ON CONFLICT DO NOTHING;

-- avihu's share of the business (spec §2 decision 6). A dated parameter, never a constant in code.
INSERT INTO parameters (key, effective_from, value, source, confidence) VALUES
  ('ownership_pct:head-spa-israel', '2000-01-01', '{"pct": 0.5}', 'spec:BUILD-SPEC §2 decision 6', 'fact')
ON CONFLICT DO NOTHING;
