-- Finance engine for the Personal and Household workspaces.
--
-- One engine, separate data: every row carries workspace_id, and the personal workspace is readable
-- by its owner only (see 20261010000000_workspaces.sql). Nothing here is seeded with anyone's
-- money: accounts, budgets, recurring expenses, goals and contributions are created from the UI.
-- The only seed is a starter list of categories per workspace, which the user can rename or delete.
--
-- Money between workspaces moves as a *linked transfer*: a personal "transfer out" row and a
-- household "income · contribution" row point at each other (linked_transaction_id), so the same
-- shekel is never counted twice. The household sees the contribution, never the income behind it.

BEGIN;

-- ── Accounts ──────────────────────────────────────────────────────────────────
-- Never a full card or account number: last 4 digits at most.
CREATE TABLE IF NOT EXISTS financial_accounts (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid          NOT NULL REFERENCES workspaces (id),
  owner_user_id    text          NOT NULL REFERENCES users (id),
  kind             text          NOT NULL CHECK (kind IN ('bank', 'credit_card', 'cash', 'savings', 'investment', 'loan', 'other')),
  name             text          NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  institution      text          CHECK (char_length(institution) <= 80),
  last4            text          CHECK (last4 ~ '^\d{4}$'),
  currency         text          NOT NULL DEFAULT 'ILS' CHECK (currency ~ '^[A-Z]{3}$'),
  opening_balance  numeric(14,2),
  balance          numeric(14,2),                                   -- last known balance, typed in or from a statement
  balance_as_of    date,
  credit_limit     numeric(14,2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
  billing_day      smallint      CHECK (billing_day BETWEEN 1 AND 31),
  notes            text          CHECK (char_length(notes) <= 1000),
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_fin_accounts_ws ON financial_accounts (workspace_id) WHERE deleted_at IS NULL;

-- ── Categories (per workspace, editable) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_categories (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces (id),
  kind          text        NOT NULL CHECK (kind IN ('income', 'expense')),
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  parent_id     uuid        REFERENCES transaction_categories (id),      -- set = a subcategory
  key           text        CHECK (key ~ '^[a-z][a-z0-9-]{1,40}$'),     -- starter categories keep a stable key
  sort          int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_tx_categories_ws ON transaction_categories (workspace_id, kind) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_categories_key ON transaction_categories (workspace_id, key) WHERE key IS NOT NULL AND deleted_at IS NULL;

-- Starter categories for a personal or household workspace. A starting point only: every one can be
-- renamed, nested or deleted in the UI.
CREATE OR REPLACE FUNCTION app_seed_categories(p_ws uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
  IF EXISTS (SELECT 1 FROM transaction_categories WHERE workspace_id = p_ws) THEN RETURN; END IF;
  SELECT kind INTO k FROM workspaces WHERE id = p_ws;
  IF k NOT IN ('personal', 'household') THEN RETURN; END IF;
  INSERT INTO transaction_categories (workspace_id, kind, name, key, sort)
  SELECT p_ws, 'expense', x.name, x.key, x.sort FROM (VALUES
    ('housing', 'דיור', 1), ('food', 'מזון', 2), ('transport', 'תחבורה', 3), ('bills', 'חשבונות', 4),
    ('insurance', 'ביטוח', 5), ('children', 'ילדים', 6), ('entertainment', 'בילוי ופנאי', 7), ('travel', 'חופשות', 8),
    ('shopping', 'קניות', 9), ('health', 'בריאות', 10), ('savings', 'חיסכון', 11), ('other-expense', 'אחר', 99)) AS x(key, name, sort);
  IF k = 'personal' THEN
    INSERT INTO transaction_categories (workspace_id, kind, name, key, sort) VALUES
      (p_ws, 'income', 'משכורת', 'salary', 1), (p_ws, 'income', 'הכנסה מעסק', 'business-income', 2),
      (p_ws, 'income', 'הכנסה פסיבית', 'passive', 3), (p_ws, 'income', 'החזרים', 'refunds', 4), (p_ws, 'income', 'אחר', 'other-income', 99);
  ELSE
    INSERT INTO transaction_categories (workspace_id, kind, name, key, sort) VALUES
      (p_ws, 'income', 'העברות מחברים', 'contribution', 1), (p_ws, 'income', 'הכנסה משותפת', 'shared-income', 2),
      (p_ws, 'income', 'החזרים', 'refunds', 3), (p_ws, 'income', 'אחר', 'other-income', 99);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_workspace_seed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_seed_categories(NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_workspaces_seed ON workspaces;
CREATE TRIGGER trg_workspaces_seed AFTER INSERT ON workspaces FOR EACH ROW EXECUTE FUNCTION app_workspace_seed();
SELECT app_seed_categories(id) FROM workspaces WHERE kind IN ('personal', 'household') AND deleted_at IS NULL;

-- ── Transactions: the fields of the personal / household engine ───────────────
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_direction_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_direction_check CHECK (direction IN ('income', 'expense', 'transfer'));
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS flow                  text          CHECK (flow IN ('in', 'out'));   -- transfers only
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS merchant              text          CHECK (char_length(merchant) <= 120);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS currency              text          NOT NULL DEFAULT 'ILS' CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_id            uuid          REFERENCES financial_accounts (id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category_id           uuid          REFERENCES transaction_categories (id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS subcategory_id        uuid          REFERENCES transaction_categories (id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fixed_or_variable     text          CHECK (fixed_or_variable IN ('fixed', 'variable'));
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS frequency             text          CHECK (frequency IN ('one_time', 'monthly', 'bimonthly', 'quarterly', 'yearly', 'custom'));
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source                text          NOT NULL DEFAULT 'manual'
                                                                      CHECK (source IN ('manual', 'statement', 'receipt', 'gmail', 'contribution', 'recurring'));
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS document_id           uuid          REFERENCES documents (id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes                 text          CHECK (char_length(notes) <= 1000);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS linked_transaction_id uuid          REFERENCES transactions (id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recurring_expense_id  uuid;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS import_id             uuid;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS dedupe_key            text;          -- date|amount|normalized merchant, for re-imports
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_flow_check2;
ALTER TABLE transactions ADD CONSTRAINT transactions_flow_check2 CHECK ((direction = 'transfer') = (flow IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_transactions_ws_date ON transactions (workspace_id, occurred_on) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_dedupe  ON transactions (workspace_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions (account_id) WHERE account_id IS NOT NULL AND deleted_at IS NULL;

-- ── Budgets ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid          NOT NULL REFERENCES workspaces (id),
  month         date          NOT NULL CHECK (extract(day FROM month) = 1),
  notes         text          CHECK (char_length(notes) <= 1000),
  created_by    text          REFERENCES users (id),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_month ON budgets (workspace_id, month) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS budget_categories (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id    uuid          NOT NULL REFERENCES budgets (id),
  category_id  uuid          NOT NULL REFERENCES transaction_categories (id),
  amount       numeric(14,2) NOT NULL CHECK (amount >= 0),
  UNIQUE (budget_id, category_id)
);

-- ── Recurring expenses ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid          NOT NULL REFERENCES workspaces (id),
  owner_user_id    text          NOT NULL REFERENCES users (id),
  name             text          NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  merchant         text          CHECK (char_length(merchant) <= 120),
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  currency         text          NOT NULL DEFAULT 'ILS' CHECK (currency ~ '^[A-Z]{3}$'),
  category_id      uuid          REFERENCES transaction_categories (id),
  account_id       uuid          REFERENCES financial_accounts (id),
  frequency        text          NOT NULL CHECK (frequency IN ('monthly', 'yearly', 'custom', 'one_time')),
  interval_months  smallint      CHECK (interval_months BETWEEN 1 AND 60),         -- custom: every N months
  day_of_month     smallint      CHECK (day_of_month BETWEEN 1 AND 31),
  next_due         date,
  start_date       date,
  end_date         date,
  status           text          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  notes            text          CHECK (char_length(notes) <= 1000),
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CHECK (frequency <> 'custom' OR interval_months IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_recurring_ws ON recurring_expenses (workspace_id) WHERE deleted_at IS NULL;

-- ── Savings goals (household goals are shared; personal ones stay private) ────
CREATE TABLE IF NOT EXISTS savings_goals (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid          NOT NULL REFERENCES workspaces (id),
  owner_user_id         text          NOT NULL REFERENCES users (id),
  name                  text          NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  target_amount         numeric(14,2) NOT NULL CHECK (target_amount > 0),
  current_amount        numeric(14,2) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  deadline              date,
  monthly_contribution  numeric(14,2) CHECK (monthly_contribution IS NULL OR monthly_contribution >= 0),
  account_id            uuid          REFERENCES financial_accounts (id),
  status                text          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reached', 'paused', 'dropped')),
  notes                 text          CHECK (char_length(notes) <= 1000),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE INDEX IF NOT EXISTS idx_savings_ws ON savings_goals (workspace_id) WHERE deleted_at IS NULL;

-- ── Household contributions ───────────────────────────────────────────────────
-- The plan: what a member transfers from their personal workspace to a household. A percentage rule
-- is computed privately on the personal side: the household reads only the amount of each payment.
CREATE TABLE IF NOT EXISTS household_contributions (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid          NOT NULL REFERENCES workspaces (id),          -- the household
  user_id                text          NOT NULL REFERENCES users (id),               -- the contributor
  personal_workspace_id  uuid          NOT NULL REFERENCES workspaces (id),
  rule                   text          NOT NULL CHECK (rule IN ('fixed', 'percentage', 'manual')),
  amount                 numeric(14,2) CHECK (amount IS NULL OR amount > 0),          -- fixed
  percentage             numeric(5,2)  CHECK (percentage IS NULL OR (percentage > 0 AND percentage <= 100)),  -- private
  frequency              text          NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'one_time', 'custom')),
  day_of_month           smallint      NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  start_date             date          NOT NULL,
  end_date               date,
  status                 text          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  auto_or_manual         text          NOT NULL DEFAULT 'manual' CHECK (auto_or_manual IN ('auto', 'manual')),
  source_account_id      uuid          REFERENCES financial_accounts (id),           -- personal account (private)
  target_account_id      uuid          REFERENCES financial_accounts (id),           -- household account
  created_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at             timestamptz   NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  CHECK (rule <> 'fixed' OR amount IS NOT NULL),
  CHECK (rule <> 'percentage' OR percentage IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contribution_active ON household_contributions (workspace_id, user_id)
  WHERE deleted_at IS NULL AND status <> 'ended';

-- Each transfer actually made (or expected) in a period
CREATE TABLE IF NOT EXISTS household_contribution_payments (
  id                        uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id           uuid          NOT NULL REFERENCES household_contributions (id),
  workspace_id              uuid          NOT NULL REFERENCES workspaces (id),
  user_id                   text          NOT NULL REFERENCES users (id),
  period                    date          NOT NULL CHECK (extract(day FROM period) = 1),
  amount                    numeric(14,2) NOT NULL CHECK (amount > 0),
  status                    text          NOT NULL DEFAULT 'received' CHECK (status IN ('pending', 'received', 'cancelled')),
  paid_on                   date,
  personal_transaction_id   uuid          REFERENCES transactions (id),
  household_transaction_id  uuid          REFERENCES transactions (id),
  created_by                text          REFERENCES users (id),
  created_at                timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contrib_payments ON household_contribution_payments (workspace_id, period) WHERE status <> 'cancelled';

-- ── Categorization rules ("remember this choice") ─────────────────────────────
CREATE TABLE IF NOT EXISTS categorization_rules (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        text        NOT NULL REFERENCES users (id),
  match_field          text        NOT NULL DEFAULT 'merchant' CHECK (match_field IN ('merchant', 'description')),
  match_type           text        NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains', 'equals', 'starts_with')),
  pattern              text        NOT NULL CHECK (char_length(pattern) BETWEEN 2 AND 120),
  target_workspace_id  uuid        NOT NULL REFERENCES workspaces (id),
  category_id          uuid        REFERENCES transaction_categories (id),
  subcategory_id       uuid        REFERENCES transaction_categories (id),
  fixed_or_variable    text        CHECK (fixed_or_variable IN ('fixed', 'variable')),
  frequency            text        CHECK (frequency IN ('one_time', 'monthly', 'bimonthly', 'quarterly', 'yearly', 'custom')),
  priority             int         NOT NULL DEFAULT 100,
  hits                 int         NOT NULL DEFAULT 0,
  active               boolean     NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);
CREATE INDEX IF NOT EXISTS idx_rules_owner ON categorization_rules (owner_user_id) WHERE deleted_at IS NULL AND active;

-- ── Imports: statements, receipts, Gmail ──────────────────────────────────────
-- Nothing becomes a transaction until the user approves it: rows wait in import_candidates.
CREATE TABLE IF NOT EXISTS statement_imports (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        text        NOT NULL REFERENCES users (id),
  workspace_id         uuid        NOT NULL REFERENCES workspaces (id),               -- where rows default to
  account_id           uuid        REFERENCES financial_accounts (id),
  source               text        NOT NULL CHECK (source IN ('statement', 'receipt', 'gmail')),
  format               text        NOT NULL CHECK (format IN ('csv', 'xlsx', 'pdf', 'image', 'url', 'email')),
  file_id              uuid        REFERENCES files (id),
  file_name            text        CHECK (char_length(file_name) <= 200),
  status               text        NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'imported', 'failed', 'cancelled')),
  row_count            int         NOT NULL DEFAULT 0,
  imported_count       int         NOT NULL DEFAULT 0,
  error                text        CHECK (char_length(error) <= 500),
  created_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz
);
CREATE INDEX IF NOT EXISTS idx_imports_owner ON statement_imports (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS import_candidates (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id               uuid          NOT NULL REFERENCES statement_imports (id),
  owner_user_id           text          NOT NULL REFERENCES users (id),
  occurred_on             date,
  merchant                text          CHECK (char_length(merchant) <= 120),
  merchant_normalized     text          CHECK (char_length(merchant_normalized) <= 120),
  description             text          CHECK (char_length(description) <= 500),
  amount                  numeric(14,2),
  currency                text          NOT NULL DEFAULT 'ILS',
  direction               text          CHECK (direction IN ('income', 'expense')),
  vat_amount              numeric(14,2),
  document_number         text          CHECK (char_length(document_number) <= 40),
  target_workspace_id     uuid          REFERENCES workspaces (id),
  category_id             uuid          REFERENCES transaction_categories (id),
  subcategory_id          uuid          REFERENCES transaction_categories (id),
  fixed_or_variable       text          CHECK (fixed_or_variable IN ('fixed', 'variable')),
  frequency               text          CHECK (frequency IN ('one_time', 'monthly', 'bimonthly', 'quarterly', 'yearly', 'custom')),
  rule_id                 uuid          REFERENCES categorization_rules (id),
  status                  text          NOT NULL DEFAULT 'review'
                                        CHECK (status IN ('auto', 'review', 'unrecognized', 'duplicate', 'skipped', 'imported')),
  duplicate_of            uuid          REFERENCES transactions (id),
  matched_transaction_id  uuid          REFERENCES transactions (id),               -- a receipt that belongs to an existing row
  imported_transaction_id uuid          REFERENCES transactions (id),
  external_id             text          CHECK (char_length(external_id) <= 200),   -- Gmail message id
  sort                    int,
  created_at              timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidates_import ON import_candidates (import_id, sort);
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_external ON import_candidates (owner_user_id, external_id) WHERE external_id IS NOT NULL;

-- ── RLS, prepared like the workspaces migration ───────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['financial_accounts', 'transaction_categories', 'budgets', 'budget_categories', 'recurring_expenses',
                           'savings_goals', 'household_contributions', 'household_contribution_payments',
                           'categorization_rules', 'statement_imports', 'import_candidates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN RETURN; END IF;
  FOREACH t IN ARRAY ARRAY['financial_accounts', 'transaction_categories', 'budgets', 'recurring_expenses', 'savings_goals',
                           'household_contribution_payments'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS ws_isolation ON %I', t);
    EXECUTE format('CREATE POLICY ws_isolation ON %I FOR ALL TO authenticated
                    USING (app_can_read_workspace(workspace_id, current_setting(''app.user_id'', true)))', t);
  END LOOP;
  -- Contributions: the contributor, or members of the household (the rule's private fields are never selected by the app)
  DROP POLICY IF EXISTS ws_isolation ON household_contributions;
  CREATE POLICY ws_isolation ON household_contributions FOR ALL TO authenticated
    USING (user_id = current_setting('app.user_id', true) OR app_can_read_workspace(workspace_id, current_setting('app.user_id', true)));
  -- Rules, imports and candidates are their owner's alone (a mailbox or a statement is private)
  FOREACH t IN ARRAY ARRAY['categorization_rules', 'statement_imports', 'import_candidates'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS owner_only ON %I', t);
    EXECUTE format('CREATE POLICY owner_only ON %I FOR ALL TO authenticated USING (owner_user_id = current_setting(''app.user_id'', true))', t);
  END LOOP;
END $$;

COMMIT;
