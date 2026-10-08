-- Migration: stage 3 (branches by configuration, Buyz integration table, ventures, documents,
-- search, activity log). Additive only: new tables, new nullable/defaulted columns. Nothing is
-- dropped or rewritten. Naming follows stages 1-2: domain = area, branch = entity, location = branch.
-- Every user-owned row has owner_user_id + scope and is filtered with visibleSql (src/server/auth.ts).

-- Links any record to the object it is about (a property, an investment, a legal case …).
-- subject_type is one of: asset, liability, investment, legal_case, contact.
ALTER TABLE work_items   ADD COLUMN IF NOT EXISTS subject_type text;
ALTER TABLE work_items   ADD COLUMN IF NOT EXISTS subject_id   uuid;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS subject_type text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS subject_id   uuid;
CREATE INDEX IF NOT EXISTS idx_work_items_subject   ON work_items (subject_type, subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_subject ON transactions (subject_type, subject_id) WHERE subject_id IS NOT NULL;

-- ── 3.1 / 3.2 Head Spa branches and integrations ───────────────────────────────
-- (owned by the Head Spa / integrations work)
--
-- A branch (location) is configuration: one `locations` row adds it to the nav, the breadcrumb,
-- the place menus, the company overview and its own /business/<entity>/<location> page.
-- `status` says whether it is operating ('active') or being set up ('setup' → tag "בהקמה").
-- active = false is also shown as "בהקמה" (the row exists, the branch is not open).
ALTER TABLE locations ADD COLUMN IF NOT EXISTS status text;
UPDATE locations SET status = CASE WHEN branch = 'head-spa-israel' AND location = 'jerusalem' THEN 'setup' ELSE 'active' END
  WHERE status IS NULL;                                        -- only fills the new column
ALTER TABLE locations ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE locations ALTER COLUMN status SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE locations ADD CONSTRAINT locations_status_check CHECK (status IN ('active', 'setup'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One external data source per location (Buyz today; any provider later).
-- SECURITY: credentials are never stored for Buyz. The key lives only in the server env var named
-- by credentials_ref ('env:BUYZ_API_KEY'); the sync resolves it at run time and never logs it.
-- credentials_encrypted exists for future providers that must store a token, and stays NULL for
-- Buyz (enforced below). The sync never requests Buyz `transactions` (customer names / PII).
CREATE TABLE IF NOT EXISTS integrations (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              text        NOT NULL CHECK (provider IN ('buyz')),
  domain                text        NOT NULL,
  branch                text        NOT NULL,
  location              text        NOT NULL,
  credentials_ref       text        CHECK (credentials_ref ~ '^env:[A-Z][A-Z0-9_]{0,63}$'),
  credentials_encrypted bytea,                               -- NULL for Buyz, see above
  config                jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- buyz: {source_account, amounts_include_vat}
  status                text        NOT NULL DEFAULT 'not_connected'
                          CHECK (status IN ('ok', 'error', 'disabled', 'not_connected')),
  last_sync_at          timestamptz,
  last_error            text        CHECK (char_length(last_error) <= 300),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, domain, branch, location),
  FOREIGN KEY (domain, branch) REFERENCES branches (domain, branch),
  FOREIGN KEY (branch, location) REFERENCES locations (branch, location),
  CONSTRAINT integrations_buyz_no_stored_key CHECK (provider <> 'buyz' OR credentials_encrypted IS NULL)
);
COMMENT ON COLUMN integrations.credentials_ref IS
  'Where the secret lives: env:<VAR>. Buyz = env:BUYZ_API_KEY. The key itself is never stored in the DB, code, logs or docs.';
COMMENT ON COLUMN integrations.credentials_encrypted IS
  'Always NULL for Buyz (constraint integrations_buyz_no_stored_key). Reserved for future providers.';

-- What Buyz reports, stored locally so pages never call Buyz on load. Amounts as reported
-- (Buyz: incl. VAT, see config.amounts_include_vat). No row = no data, never 0.
-- Item/staff/method rows of a month are replaced by a newer report through fetched_at: readers
-- take only the rows whose fetched_at equals the month summary's fetched_at (nothing is deleted).
CREATE TABLE IF NOT EXISTS revenue_daily (
  integration_id  uuid          NOT NULL REFERENCES integrations (id),
  day             date          NOT NULL,
  revenue_total   numeric(14,2) NOT NULL,
  tx_count        int,
  bookings        numeric(14,2),
  vouchers        numeric(14,2),
  sales           numeric(14,2),
  fetched_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, day)
);

-- One row per month and source: totals and counts only. customers_* / cancellations_count are
-- filled only when the provider returns such aggregate numbers; never derived from personal data.
CREATE TABLE IF NOT EXISTS revenue_month_summary (
  integration_id      uuid          NOT NULL REFERENCES integrations (id),
  month               date          NOT NULL,                -- first day of the month
  revenue_total       numeric(14,2),
  tx_count            int,
  average_transaction numeric(14,2),
  unpaid_total        numeric(14,2),
  bookings_total      numeric(14,2),
  bookings_count      int,                                   -- treatments (booked appointments)
  vouchers_total      numeric(14,2),
  vouchers_count      int,
  sales_total         numeric(14,2),
  sales_count         int,
  orders_count        int,
  customers_count     int,
  new_customers_count int,
  cancellations_count int,
  fetched_at          timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, month)
);

-- Top items (products / treatments sold) per month
CREATE TABLE IF NOT EXISTS revenue_items_monthly (
  integration_id  uuid          NOT NULL REFERENCES integrations (id),
  month           date          NOT NULL,
  name            text          NOT NULL CHECK (char_length(name) <= 200),
  count           numeric(12,2),
  total           numeric(14,2),
  fetched_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, month, name)
);

-- Sales by seller = staff (employees' names, no customer data)
CREATE TABLE IF NOT EXISTS revenue_staff_monthly (
  integration_id  uuid          NOT NULL REFERENCES integrations (id),
  month           date          NOT NULL,
  name            text          NOT NULL CHECK (char_length(name) <= 200),
  count           numeric(12,2),
  total           numeric(14,2),
  fetched_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, month, name)
);

CREATE TABLE IF NOT EXISTS revenue_methods_monthly (
  integration_id  uuid          NOT NULL REFERENCES integrations (id),
  month           date          NOT NULL,
  method          text          NOT NULL CHECK (char_length(method) <= 100),
  label           text          CHECK (char_length(label) <= 100),
  count           int,
  total           numeric(14,2),
  fetched_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, month, method)
);

ALTER TABLE integrations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_daily           ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_month_summary   ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_items_monthly   ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_staff_monthly   ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_methods_monthly ENABLE ROW LEVEL SECURITY;

-- Modiin's Buyz account, from revenue_sources. The key is NOT here: only a reference to the env var.
INSERT INTO integrations (provider, domain, branch, location, credentials_ref, credentials_encrypted, config, status, last_sync_at)
SELECT 'buyz', s.domain, s.branch, s.location, 'env:BUYZ_API_KEY', NULL,
       jsonb_build_object('source_account', s.source_account, 'amounts_include_vat', s.amounts_include_vat),
       CASE WHEN m.last IS NULL THEN 'not_connected' ELSE 'ok' END, m.last
FROM revenue_sources s
LEFT JOIN LATERAL (SELECT max(fetched_at) AS last FROM revenue_monthly r
                   WHERE r.source = s.source AND r.source_account = s.source_account) m ON true
WHERE s.source = 'buyz' AND s.active AND s.branch = 'head-spa-israel' AND s.location = 'modiin'
ON CONFLICT DO NOTHING;

-- ── 3.3 Ventures: properties, loans, investments, legal cases, contacts ───────
-- A property (נכס) is its own object under ventures/real-estate, with value, cost, loans, money,
-- tasks, contacts and documents linked to it by subject_type/subject_id. Value carries its date and
-- source: an estimate is shown as "הערכה", never as fact. Money stays in `transactions`.
CREATE TABLE IF NOT EXISTS assets (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  domain          text          NOT NULL DEFAULT 'ventures' CHECK (domain = 'ventures'),
  branch          text          NOT NULL DEFAULT 'real-estate' CHECK (branch = 'real-estate'),
  location        text          CHECK (location IS NULL),
  kind            text          NOT NULL DEFAULT 'apartment' CHECK (kind IN ('apartment', 'house', 'commercial', 'land', 'other')),
  name            text          NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  address         text          CHECK (char_length(address) <= 200),
  purchase_date   date,
  purchase_cost   numeric(14,2) CHECK (purchase_cost > 0),          -- incl. purchase tax, lawyer, broker
  current_value   numeric(14,2) CHECK (current_value > 0),
  value_date      date,
  value_source    text          CHECK (value_source IN ('estimate', 'appraisal', 'purchase')),
  notes           text          CHECK (char_length(notes) <= 2000),
  owner_user_id   text          NOT NULL DEFAULT 'avihu' REFERENCES users (id),
  scope           text          NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'shared')),
  created_by      text          REFERENCES users (id),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CHECK ((current_value IS NULL) = (value_source IS NULL)),
  CHECK (current_value IS NULL OR value_date IS NOT NULL),
  FOREIGN KEY (domain, branch) REFERENCES branches (domain, branch)
);
CREATE INDEX IF NOT EXISTS idx_assets_live ON assets (created_at) WHERE deleted_at IS NULL;

-- A loan that financed a property. venture_share_pct = how much of every repayment belongs to the
-- venture; the rest is recorded on the personal side (the bank account it is paid from stays personal).
CREATE TABLE IF NOT EXISTS liabilities (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id           uuid          REFERENCES assets (id),
  domain             text          NOT NULL DEFAULT 'ventures' CHECK (domain = 'ventures'),
  branch             text          NOT NULL DEFAULT 'real-estate',
  location           text          CHECK (location IS NULL),
  kind               text          NOT NULL DEFAULT 'mortgage' CHECK (kind IN ('mortgage', 'loan', 'other')),
  lender             text          NOT NULL CHECK (char_length(lender) BETWEEN 1 AND 120),
  principal          numeric(14,2) NOT NULL CHECK (principal > 0),       -- original amount
  annual_rate        numeric(7,5)  NOT NULL CHECK (annual_rate >= 0 AND annual_rate < 1),
  start_date         date          NOT NULL,
  term_months        integer       NOT NULL CHECK (term_months BETWEEN 1 AND 600),
  monthly_payment    numeric(14,2) NOT NULL CHECK (monthly_payment > 0),
  balance            numeric(14,2) NOT NULL CHECK (balance >= 0),
  balance_date       date          NOT NULL,
  venture_share_pct  numeric(5,2)  NOT NULL DEFAULT 100 CHECK (venture_share_pct BETWEEN 0 AND 100),
  status             text          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  notes              text          CHECK (char_length(notes) <= 1000),
  owner_user_id      text          NOT NULL DEFAULT 'avihu' REFERENCES users (id),
  scope              text          NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'shared')),
  created_by         text          REFERENCES users (id),
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CHECK (balance <= principal * 1.5),
  FOREIGN KEY (domain, branch) REFERENCES branches (domain, branch)
);
CREATE INDEX IF NOT EXISTS idx_liabilities_asset ON liabilities (asset_id) WHERE deleted_at IS NULL;

-- One repayment: interest/principal split (interest = balance × rate / 12 at the time) and the two
-- expense transactions it created (venture share and personal share, either may be absent at 0/100%).
CREATE TABLE IF NOT EXISTS liability_payments (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  liability_id       uuid          NOT NULL REFERENCES liabilities (id),
  paid_on            date          NOT NULL,
  amount             numeric(14,2) NOT NULL CHECK (amount > 0),
  interest           numeric(14,2) NOT NULL CHECK (interest >= 0),
  principal          numeric(14,2) NOT NULL CHECK (principal >= 0),
  balance_before     numeric(14,2) NOT NULL CHECK (balance_before >= 0),
  balance_after      numeric(14,2) NOT NULL CHECK (balance_after >= 0),
  balance_date_before date         NOT NULL,                          -- restored if this payment is undone
  venture_share_pct  numeric(5,2)  NOT NULL CHECK (venture_share_pct BETWEEN 0 AND 100),
  venture_tx_id      uuid          REFERENCES transactions (id),
  personal_tx_id     uuid          REFERENCES transactions (id),
  created_by         text          REFERENCES users (id),
  created_at         timestamptz   NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CHECK (interest + principal = amount),
  CHECK (balance_after = balance_before - principal)
);
CREATE INDEX IF NOT EXISTS idx_liability_payments ON liability_payments (liability_id, paid_on) WHERE deleted_at IS NULL;

-- An investment. ticker/quantity/external_ref are for a future market-data link (empty for now).
CREATE TABLE IF NOT EXISTS investments (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  domain           text          NOT NULL DEFAULT 'ventures' CHECK (domain = 'ventures'),
  branch           text          NOT NULL DEFAULT 'investments' CHECK (branch = 'investments'),
  location         text          CHECK (location IS NULL),
  category         text          NOT NULL DEFAULT 'other'
                                 CHECK (category IN ('stocks', 'bonds', 'fund', 'pension', 'deposit', 'crypto', 'private', 'real-estate', 'other')),
  name             text          NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  amount_invested  numeric(14,2) NOT NULL CHECK (amount_invested > 0),
  invested_on      date          NOT NULL,
  current_value    numeric(14,2) CHECK (current_value >= 0),
  value_date       date,
  value_source     text          CHECK (value_source IN ('estimate', 'statement', 'market')),
  ticker           text          CHECK (ticker ~ '^[A-Za-z0-9.\-:]{1,20}$'),
  quantity         numeric(18,6) CHECK (quantity > 0),
  external_ref     text          CHECK (char_length(external_ref) <= 120),
  status           text          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'exited')),
  notes            text          CHECK (char_length(notes) <= 2000),
  owner_user_id    text          NOT NULL DEFAULT 'avihu' REFERENCES users (id),
  scope            text          NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'shared')),
  created_by       text          REFERENCES users (id),
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CHECK ((current_value IS NULL) = (value_date IS NULL)),
  CHECK ((current_value IS NULL) = (value_source IS NULL)),
  FOREIGN KEY (domain, branch) REFERENCES branches (domain, branch)
);
CREATE INDEX IF NOT EXISTS idx_investments_live ON investments (invested_on) WHERE deleted_at IS NULL;

-- A legal case. The next deadline is computed from case_deadlines (never stored, never stale).
CREATE TABLE IF NOT EXISTS legal_cases (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  domain         text        NOT NULL DEFAULT 'ventures' CHECK (domain = 'ventures'),
  branch         text        NOT NULL DEFAULT 'legal-and-tasks' CHECK (branch = 'legal-and-tasks'),
  location       text        CHECK (location IS NULL),
  title          text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  case_number    text        CHECK (char_length(case_number) <= 60),
  court          text        CHECK (char_length(court) <= 120),
  status         text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting', 'closed')),
  parties        text        CHECK (char_length(parties) <= 500),
  lawyer         text        CHECK (char_length(lawyer) <= 120),
  opened_on      date,
  closed_on      date,
  notes          text        CHECK (char_length(notes) <= 4000),
  owner_user_id  text        NOT NULL DEFAULT 'avihu' REFERENCES users (id),
  scope          text        NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'shared')),
  created_by     text        REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CHECK (closed_on IS NULL OR opened_on IS NULL OR closed_on >= opened_on),
  FOREIGN KEY (domain, branch) REFERENCES branches (domain, branch)
);

CREATE TABLE IF NOT EXISTS case_deadlines (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid        NOT NULL REFERENCES legal_cases (id),
  due_on      date        NOT NULL,
  title       text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  done_at     timestamptz,
  created_by  text        REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_case_deadlines_open ON case_deadlines (case_id, due_on) WHERE deleted_at IS NULL AND done_at IS NULL;

-- People around ventures objects (lawyer, tenant, broker, accountant …), linked to any object.
CREATE TABLE IF NOT EXISTS contacts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  domain         text        NOT NULL DEFAULT 'ventures' REFERENCES areas (id),
  branch         text,
  location       text,
  name           text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  role           text        CHECK (char_length(role) <= 60),
  phone          text        CHECK (phone ~ '^[0-9+\-() ]{3,30}$'),
  email          text        CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notes          text        CHECK (char_length(notes) <= 1000),
  owner_user_id  text        NOT NULL DEFAULT 'avihu' REFERENCES users (id),
  scope          text        NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'shared')),
  created_by     text        REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CHECK (location IS NULL OR branch IS NOT NULL),
  FOREIGN KEY (domain, branch)   REFERENCES branches (domain, branch),
  FOREIGN KEY (branch, location) REFERENCES locations (branch, location)
);

CREATE TABLE IF NOT EXISTS contact_links (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    uuid        NOT NULL REFERENCES contacts (id),
  subject_type  text        NOT NULL CHECK (subject_type IN ('asset', 'liability', 'investment', 'legal_case')),
  subject_id    uuid        NOT NULL,
  created_by    text        REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_link ON contact_links (contact_id, subject_type, subject_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contact_links_subject ON contact_links (subject_type, subject_id) WHERE deleted_at IS NULL;

ALTER TABLE assets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE liabilities        ENABLE ROW LEVEL SECURITY;
ALTER TABLE liability_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE investments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_cases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_deadlines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_links      ENABLE ROW LEVEL SECURITY;

-- ── 3.4 Documents ─────────────────────────────────────────────────────────────
-- One document system: every document belongs to an area (domain), optionally an entity (branch)
-- and a branch (location), and optionally to one object (subject_type/subject_id: asset,
-- investment, legal_case … — no FK, those tables belong to the ventures work). The file bytes live
-- in `files`; each upload is a numbered version, current_version points at the latest.
CREATE TABLE IF NOT EXISTS documents (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  doc_type         text        NOT NULL DEFAULT 'other'
                               CHECK (doc_type IN ('invoice', 'receipt', 'contract', 'legal', 'report', 'other')),
  domain           text        NOT NULL REFERENCES areas (id),
  branch           text,
  location         text,
  subject_type     text        CHECK (subject_type ~ '^[a-z][a-z_]{1,39}$'),
  subject_id       uuid,
  doc_date         date,
  current_version  integer     NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  notes            text        CHECK (char_length(notes) <= 1000),
  owner_user_id    text        NOT NULL DEFAULT 'avihu' REFERENCES users (id),
  scope            text        NOT NULL DEFAULT 'shared' CHECK (scope IN ('user', 'shared')),
  created_by       text        REFERENCES users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CHECK (location IS NULL OR branch IS NOT NULL),
  CHECK ((subject_type IS NULL) = (subject_id IS NULL)),
  FOREIGN KEY (domain, branch)   REFERENCES branches (domain, branch),
  FOREIGN KEY (branch, location) REFERENCES locations (branch, location)
);
CREATE INDEX IF NOT EXISTS idx_documents_place   ON documents (domain, branch, location) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_subject ON documents (subject_type, subject_id) WHERE subject_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_date    ON documents (doc_date DESC NULLS LAST, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS document_versions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid        NOT NULL REFERENCES documents (id),
  version      integer     NOT NULL CHECK (version >= 1),
  file_id      uuid        NOT NULL REFERENCES files (id),
  note         text        CHECK (char_length(note) <= 300),
  created_by   text        REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);
CREATE INDEX IF NOT EXISTS idx_document_versions_file ON document_versions (file_id);

ALTER TABLE documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;

-- ── 3.5 / 3.6 Search and activity log ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log (user_id, created_at DESC);

-- Global search (⌘K) uses ILIKE '%…%'. Trigram GIN indexes make that an index scan once tables
-- grow. pg_trgm ships with Postgres contrib and Supabase; when it cannot be installed the
-- indexes are skipped and search still works (sequential scan). The operator class is looked up
-- in whatever schema the extension lives in (Supabase: `extensions`), so search_path does not
-- matter. Tables or columns that do not exist yet (ventures work) are skipped too.
DO $$
DECLARE
  ext_schema text;
  t record;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm not available (%), search indexes skipped', SQLERRM;
  END;
  SELECT n.nspname INTO ext_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm';
  IF ext_schema IS NULL THEN RETURN; END IF;
  FOR t IN SELECT * FROM (VALUES
      ('idx_trgm_work_items_title',     'work_items',   'title'),
      ('idx_trgm_tasks_text',           'tasks',        'text'),
      ('idx_trgm_goals_title',          'goals',        'title'),
      ('idx_trgm_events_title',         'events',       'title'),
      ('idx_trgm_receivables_client',   'receivables',  'client_name'),
      ('idx_trgm_transactions_desc',    'transactions', 'description'),
      ('idx_trgm_transactions_cp',      'transactions', 'counterparty_name'),
      ('idx_trgm_documents_title',      'documents',    'title'),
      ('idx_trgm_files_name',           'files',        'name'),
      ('idx_trgm_assets_name',          'assets',       'name'),
      ('idx_trgm_investments_name',     'investments',  'name'),
      ('idx_trgm_legal_cases_title',    'legal_cases',  'title')
    ) AS v(idx, tbl, col)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t.tbl AND column_name = t.col) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin (%I %I.gin_trgm_ops)', t.idx, t.tbl, t.col, ext_schema);
    END IF;
  END LOOP;
END $$;
