-- Migration: stage 2 (money, users, two-way calendar). Additive: new tables and new
-- nullable/defaulted columns on stage-1 tables. No data is dropped, renamed or rewritten. One index
-- is replaced: events' Google uniqueness moves from per-calendar to per-mapping (section 2.2).
--
-- Naming follows stage 1: domain = area, branch = entity, location = branch (see 20261007210000).

-- ── 2.1 Users, roles, invitations ─────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash  text;          -- bcrypt; NULL = cannot sign in with email
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at  timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (lower(email)) WHERE email IS NOT NULL;

-- What a user may see and do. domain NULL = every area (owner/admin only); branch/location narrow it.
CREATE TABLE IF NOT EXISTS workspace_members (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text        NOT NULL REFERENCES users (id),
  role        text        NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'employee', 'viewer')),
  domain      text        REFERENCES areas (id),
  branch      text,
  location    text,
  created_by  text        REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  CHECK (domain IS NOT NULL OR role IN ('owner', 'admin')),
  CHECK (branch IS NULL OR domain IS NOT NULL),
  CHECK (location IS NULL OR branch IS NOT NULL),
  FOREIGN KEY (domain, branch)   REFERENCES branches (domain, branch),
  FOREIGN KEY (branch, location) REFERENCES locations (branch, location)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_scope ON workspace_members
  (user_id, coalesce(domain, ''), coalesce(branch, ''), coalesce(location, '')) WHERE revoked_at IS NULL;
INSERT INTO workspace_members (user_id, role, domain, created_by)
SELECT 'avihu', 'owner', NULL, 'avihu'
WHERE NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id = 'avihu' AND role = 'owner' AND revoked_at IS NULL);

-- The link itself is never stored: only its sha256.
CREATE TABLE IF NOT EXISTS invitations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text        NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name         text        CHECK (char_length(name) <= 60),
  user_id      text        REFERENCES users (id),       -- an existing (inactive) user to activate, else a new one
  role         text        NOT NULL CHECK (role IN ('admin', 'manager', 'employee', 'viewer')),
  domain       text        REFERENCES areas (id),
  branch       text,
  location     text,
  token_hash   text        NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  invited_by   text        NOT NULL REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (domain IS NOT NULL OR role = 'admin'),
  CHECK (branch IS NULL OR domain IS NOT NULL),
  CHECK (location IS NULL OR branch IS NOT NULL),
  FOREIGN KEY (domain, branch)   REFERENCES branches (domain, branch),
  FOREIGN KEY (branch, location) REFERENCES locations (branch, location)
);

-- Tasks can be handed to someone (Employee sees what is assigned to them) and shown on the calendar
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS assigned_to  text REFERENCES users (id);
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS event_id     uuid REFERENCES events (id);

-- ── 2.2 Two-way Google Calendar ───────────────────────────────────────────────
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS scopes text;   -- what Google granted (read-only or read/write)
ALTER TABLE calendar_mappings ADD COLUMN IF NOT EXISTS access_role         text;          -- owner / writer / reader / freeBusyReader
ALTER TABLE calendar_mappings ADD COLUMN IF NOT EXISTS is_default_write    boolean NOT NULL DEFAULT false;
ALTER TABLE calendar_mappings ADD COLUMN IF NOT EXISTS channel_id          text;
ALTER TABLE calendar_mappings ADD COLUMN IF NOT EXISTS channel_resource_id text;
ALTER TABLE calendar_mappings ADD COLUMN IF NOT EXISTS channel_token_hash  text;          -- sha256 of the per-channel secret
ALTER TABLE calendar_mappings ADD COLUMN IF NOT EXISTS channel_expires_at  timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mapping_channel ON calendar_mappings (channel_id) WHERE channel_id IS NOT NULL;

ALTER TABLE events ADD COLUMN IF NOT EXISTS google_etag        text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS google_updated_at  timestamptz;  -- Google's own `updated`
ALTER TABLE events ADD COLUMN IF NOT EXISTS description        text CHECK (char_length(description) <= 4000);
ALTER TABLE events ADD COLUMN IF NOT EXISTS created_by         text REFERENCES users (id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS conflict_json      jsonb;        -- both versions when an edit raced a Google change
ALTER TABLE events ADD COLUMN IF NOT EXISTS conflict_at        timestamptz;

ALTER TABLE calendar_mappings ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'shared'));  -- events inherit it
-- Per-user connections: two users can both have the same Google calendar (e.g. a family
-- calendar), so a Google event is unique per mapping (= per connection), not per calendar id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_google_mapping ON events (mapping_id, google_event_id) WHERE source = 'google';
DROP INDEX IF EXISTS uq_events_google;
CREATE INDEX IF NOT EXISTS idx_work_items_event ON work_items (event_id) WHERE event_id IS NOT NULL;

-- ── 2.3 Finance ───────────────────────────────────────────────────────────────
-- amount_gross is what was paid. vat_rate is copied from `parameters` (vat_rate) for occurred_on when
-- the row is written, so a later rate change never rewrites history. VAT is never a constant in code.
CREATE TABLE IF NOT EXISTS transactions (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  direction            text          NOT NULL CHECK (direction IN ('income', 'expense')),
  occurred_on          date          NOT NULL,                       -- the transaction/document date
  amount_gross         numeric(14,2) NOT NULL CHECK (amount_gross > 0),
  vat_included         boolean       NOT NULL DEFAULT false,
  vat_rate             numeric(6,4)  CHECK (vat_rate >= 0 AND vat_rate < 1),
  vat_amount           numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  category             text          NOT NULL DEFAULT 'other' CHECK (category ~ '^[a-z][a-z0-9-]{1,40}$'),
  description          text          CHECK (char_length(description) <= 500),
  document_type        text          NOT NULL DEFAULT 'none'
                                     CHECK (document_type IN ('tax_invoice', 'receipt', 'tax_invoice_receipt', 'transaction_invoice', 'other', 'none')),
  document_number      text          CHECK (char_length(document_number) <= 40),
  counterparty_name    text          CHECK (char_length(counterparty_name) <= 120),
  counterparty_tax_id  text          CHECK (counterparty_tax_id ~ '^\d{5,9}$'),
  payment_method       text          CHECK (payment_method IN ('transfer', 'card', 'cash', 'check', 'other')),
  payment_date         date,
  classification       text          NOT NULL CHECK (classification IN ('business', 'personal', 'mixed')),
  domain               text          NOT NULL REFERENCES areas (id),
  branch               text,
  location             text,
  file_id              uuid          REFERENCES files (id),
  receivable_id        uuid,                                          -- set when it records a collection
  owner_user_id        text          NOT NULL DEFAULT 'avihu' REFERENCES users (id),
  scope                text          NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'shared')),
  created_by           text          REFERENCES users (id),
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  CHECK (vat_amount <= amount_gross),
  CHECK (vat_included OR vat_amount = 0),
  FOREIGN KEY (domain, branch)   REFERENCES branches (domain, branch),
  FOREIGN KEY (branch, location) REFERENCES locations (branch, location)
);
CREATE INDEX IF NOT EXISTS idx_transactions_date  ON transactions (occurred_on) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_place ON transactions (domain, branch, location) WHERE deleted_at IS NULL;

-- A shared expense: each person's share in percent (the rows of one transaction add up to 100)
CREATE TABLE IF NOT EXISTS transaction_splits (
  transaction_id  uuid         NOT NULL REFERENCES transactions (id),
  user_id         text         NOT NULL REFERENCES users (id),
  share_pct       numeric(5,2) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
  PRIMARY KEY (transaction_id, user_id)
);

-- ── 2.4 Collections ───────────────────────────────────────────────────────────
-- Status pending/partial/paid is stored; "overdue" is computed from due_date (never stale).
CREATE TABLE IF NOT EXISTS receivables (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name      text          NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 120),
  client_tax_id    text          CHECK (client_tax_id ~ '^\d{5,9}$'),
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),          -- incl. VAT, what the client owes
  amount_paid      numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  issued_on        date,
  due_date         date          NOT NULL,
  status           text          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid')),
  invoice_number   text          CHECK (char_length(invoice_number) <= 40),
  invoice_file_id  uuid          REFERENCES files (id),
  note             text          CHECK (char_length(note) <= 500),
  domain           text          NOT NULL DEFAULT 'business' REFERENCES areas (id),
  branch           text          DEFAULT 'adigital',
  location         text,
  owner_user_id    text          NOT NULL DEFAULT 'avihu' REFERENCES users (id),
  scope            text          NOT NULL DEFAULT 'shared' CHECK (scope IN ('user', 'shared')),
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  paid_at          timestamptz,
  deleted_at       timestamptz,
  CHECK (amount_paid <= amount),
  FOREIGN KEY (domain, branch)   REFERENCES branches (domain, branch),
  FOREIGN KEY (branch, location) REFERENCES locations (branch, location)
);
CREATE INDEX IF NOT EXISTS idx_receivables_due ON receivables (due_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS receivable_payments (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_id   uuid          NOT NULL REFERENCES receivables (id),
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_on         date          NOT NULL,
  payment_method  text          CHECK (payment_method IN ('transfer', 'card', 'cash', 'check', 'other')),
  transaction_id  uuid          REFERENCES transactions (id),
  created_by      text          REFERENCES users (id),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

-- ── 2.5 Smart Inbox ───────────────────────────────────────────────────────────
ALTER TABLE inbox_items ADD COLUMN IF NOT EXISTS fingerprint          text;   -- normalised file/text words, for suggestions
ALTER TABLE inbox_items ADD COLUMN IF NOT EXISTS classified_category  text REFERENCES categories (id);

-- ── 2.6 Goals ─────────────────────────────────────────────────────────────────
ALTER TABLE goals ADD COLUMN IF NOT EXISTS goal_type text CHECK (goal_type IN ('personal', 'business', 'branch', 'financial', 'study', 'ventures'));
ALTER TABLE goals ADD COLUMN IF NOT EXISTS notes     text CHECK (char_length(notes) <= 1000);

ALTER TABLE workspace_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_splits  ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivables         ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivable_payments ENABLE ROW LEVEL SECURITY;

-- ── Carry over the stage-1 household book ─────────────────────────────────────
-- The shared household page now reads `transactions`. Rows typed into `money_entries` are copied
-- once (same id, so re-running copies nothing twice). money_entries itself is left untouched.
INSERT INTO transactions (id, direction, occurred_on, amount_gross, vat_included, vat_amount, category, description,
                          document_type, classification, domain, owner_user_id, scope, created_by, created_at)
SELECT m.id, m.kind, m.occurred_on, m.amount, false, 0, 'other',
       left(m.category || CASE WHEN m.note IS NULL THEN '' ELSE ' · ' || m.note END, 500),
       'none', 'personal', 'personal', m.owner_user_id, m.scope, m.owner_user_id, m.created_at
FROM money_entries m
WHERE m.deleted_at IS NULL
ON CONFLICT (id) DO NOTHING;
