-- Migration: data entered in the dashboard itself (tasks, goals, household money).
-- Only creates new tables; nothing existing is altered or dropped. The vault stays read-only:
-- vault tasks keep coming through `tasks` (sync), these tables hold what is typed in the UI.
--
-- Placement: domain (business / personal / ventures) → branch (optional) → location (optional).
--   business: branch adigital | head-spa-israel, location e.g. modiin
--   personal: branch NULL, list home | personal | study
--   ventures: branch real-estate | investments | legal-and-tasks | finance
-- `owner` is the person an item belongs to ('avihu' today, 'eden' later), ready for per-user views.
-- Deleting is soft (deleted_at).

CREATE TABLE IF NOT EXISTS work_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      text        NOT NULL CHECK (domain IN ('business', 'personal', 'ventures')),
  branch      text,
  location    text,
  list        text,
  title       text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  notes       text        CHECK (char_length(notes) <= 4000),
  priority    smallint    NOT NULL DEFAULT 2 CHECK (priority IN (1, 2, 3)),   -- 1 = high
  status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'doing', 'done')),
  due         date,
  owner       text        NOT NULL DEFAULT 'avihu',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  done_at     timestamptz,
  deleted_at  timestamptz,
  FOREIGN KEY (domain, branch) REFERENCES branches (domain, branch)
);
CREATE INDEX IF NOT EXISTS idx_work_items_place ON work_items (domain, branch, location) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS goals (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      text          NOT NULL CHECK (domain IN ('business', 'personal', 'ventures')),
  branch      text,
  location    text,
  title       text          NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  unit        text          NOT NULL DEFAULT 'ils' CHECK (unit IN ('ils', 'count', 'pct')),
  target      numeric(14,2),
  current     numeric(14,2),                 -- entered by hand; NULL = not measured yet
  due         date,
  status      text          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'dropped')),
  owner       text          NOT NULL DEFAULT 'avihu',
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  FOREIGN KEY (domain, branch) REFERENCES branches (domain, branch)
);
CREATE INDEX IF NOT EXISTS idx_goals_place ON goals (domain, branch, location) WHERE deleted_at IS NULL;

-- Household income and expenses (personal, shared book). Amounts as paid (incl. VAT).
CREATE TABLE IF NOT EXISTS money_entries (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      text          NOT NULL DEFAULT 'personal' CHECK (domain = 'personal'),
  book        text          NOT NULL DEFAULT 'shared',
  kind        text          NOT NULL CHECK (kind IN ('income', 'expense')),
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  category    text          NOT NULL CHECK (char_length(category) BETWEEN 1 AND 60),
  occurred_on date          NOT NULL,
  note        text          CHECK (char_length(note) <= 500),
  owner       text          NOT NULL DEFAULT 'avihu',
  created_at  timestamptz   NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_money_entries_month ON money_entries (book, occurred_on) WHERE deleted_at IS NULL;

ALTER TABLE work_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_entries ENABLE ROW LEVEL SECURITY;
