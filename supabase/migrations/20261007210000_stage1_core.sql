-- Migration: stage 1 core (avihu's spec, 2026-10-07). Additive only: new tables, no existing
-- table is altered, nothing is dropped.
--
-- How avihu's model maps onto the existing schema (names already taken are reused, not duplicated):
--   area    → `areas` (new; same keys as the existing `domain` column: business / personal / ventures)
--   entity  → existing `branches` (domain, branch): adigital, head-spa-israel, home, real-estate …
--   branch  → existing `locations` (branch, location): head-spa-israel/modiin, head-spa-israel/jerusalem
--   task    → `work_items` (new; `tasks` holds the read-only vault tasks from sync)
-- Columns keep the codebase naming: domain = area, branch = entity, location = branch.
--
-- Times: timestamptz everywhere (stored UTC, shown Asia/Jerusalem). A task's due_date/due_time are
-- the Israel wall-clock day and time it is due, not an instant.
-- Every user-owned row has owner_user_id + scope ('user' = private to its owner, 'shared').
-- Deleting is soft (deleted_at).

CREATE TABLE IF NOT EXISTS users (
  id          text        PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,30}$'),
  name        text        NOT NULL,
  email       text,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO users (id, name, email, active) VALUES
  ('avihu', 'אביהו', 'avihu.gurzad@gmail.com', true),
  ('eden',  'עדן',   NULL,                     false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS areas (
  id       text     PRIMARY KEY CHECK (id IN ('business', 'personal', 'ventures')),
  name_he  text     NOT NULL,
  sort     smallint NOT NULL
);
INSERT INTO areas (id, name_he, sort) VALUES ('personal', 'אישי', 1), ('ventures', 'יזמות', 2), ('business', 'עסקים', 3)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS categories (
  id       text     PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,40}$'),
  name_he  text     NOT NULL,
  domain   text     REFERENCES areas (id),          -- NULL = available everywhere
  sort     smallint NOT NULL DEFAULT 50,
  active   boolean  NOT NULL DEFAULT true
);
INSERT INTO categories (id, name_he, domain, sort) VALUES
  ('general',    'כללי',    NULL,       1),
  ('home',       'בית',     'personal', 10),
  ('personal',   'אישי',    'personal', 11),
  ('study',      'לימודים', 'personal', 12),
  ('clients',    'לקוחות',  'business', 20),
  ('operations', 'תפעול',   'business', 21),
  ('marketing',  'שיווק',   'business', 22),
  ('finance',    'כספים',   NULL,       30),
  ('legal',      'משפטי',   NULL,       31)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS work_items (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  domain         text        NOT NULL REFERENCES areas (id),
  branch         text,
  location       text,
  category_id    text        NOT NULL DEFAULT 'general' REFERENCES categories (id),
  title          text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  description    text        CHECK (char_length(description) <= 4000),
  priority       smallint    NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 4),   -- P1 = most urgent
  status         text        NOT NULL DEFAULT 'todo'
                             CHECK (status IN ('todo', 'in_progress', 'waiting', 'done', 'cancelled')),
  waiting_on     text        CHECK (char_length(waiting_on) <= 120),
  due_date       date,
  due_time       time,
  owner_user_id  text        NOT NULL DEFAULT 'avihu' REFERENCES users (id),
  scope          text        NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'shared')),
  inbox_item_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  deleted_at     timestamptz,
  CHECK (due_time IS NULL OR due_date IS NOT NULL),
  CHECK (location IS NULL OR branch IS NOT NULL),
  FOREIGN KEY (domain, branch)   REFERENCES branches (domain, branch),
  FOREIGN KEY (branch, location) REFERENCES locations (branch, location)
);
CREATE INDEX IF NOT EXISTS idx_work_items_place ON work_items (domain, branch, location) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_due   ON work_items (due_date) WHERE deleted_at IS NULL AND status NOT IN ('done', 'cancelled');

CREATE TABLE IF NOT EXISTS task_checklist_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid        NOT NULL REFERENCES work_items (id),
  text        text        NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  done        boolean     NOT NULL DEFAULT false,
  sort        smallint    NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_checklist_task ON task_checklist_items (task_id) WHERE deleted_at IS NULL;

-- Google Calendar. The refresh token is stored encrypted (AES-256-GCM, key in env), never plain.
CREATE TABLE IF NOT EXISTS calendar_connections (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  text        NOT NULL REFERENCES users (id),
  provider                 text        NOT NULL DEFAULT 'google' CHECK (provider = 'google'),
  google_account_email     text,
  refresh_token_encrypted  text        NOT NULL,
  sync_token               text,        -- unused for google (tokens are per calendar, see mappings)
  last_synced_at           timestamptz,
  last_error               text,
  status                   text        NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'disconnected')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_connection ON calendar_connections (user_id, provider, google_account_email);

CREATE TABLE IF NOT EXISTS calendar_mappings (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id       uuid        NOT NULL REFERENCES calendar_connections (id),
  google_calendar_id  text        NOT NULL,
  calendar_name       text,
  color               text,
  domain              text        REFERENCES areas (id),
  branch              text,
  location            text,
  is_enabled          boolean     NOT NULL DEFAULT true,
  sync_token          text,
  last_synced_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, google_calendar_id),
  FOREIGN KEY (domain, branch)   REFERENCES branches (domain, branch),
  FOREIGN KEY (branch, location) REFERENCES locations (branch, location)
);

CREATE TABLE IF NOT EXISTS events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text        NOT NULL DEFAULT '',
  start_at            timestamptz NOT NULL,
  end_at              timestamptz NOT NULL,
  all_day             boolean     NOT NULL DEFAULT false,
  timezone            text        NOT NULL DEFAULT 'Asia/Jerusalem',
  place               text,
  status              text        NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
  source              text        NOT NULL DEFAULT 'manual' CHECK (source IN ('google', 'manual')),
  google_event_id     text,
  google_calendar_id  text,
  mapping_id          uuid        REFERENCES calendar_mappings (id),
  owner_user_id       text        NOT NULL DEFAULT 'avihu' REFERENCES users (id),
  scope               text        NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'shared')),
  domain              text        REFERENCES areas (id),
  branch              text,
  location            text,
  html_link           text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CHECK (end_at >= start_at),
  FOREIGN KEY (domain, branch)   REFERENCES branches (domain, branch),
  FOREIGN KEY (branch, location) REFERENCES locations (branch, location)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_google ON events (google_calendar_id, google_event_id) WHERE source = 'google';
CREATE INDEX IF NOT EXISTS idx_events_time ON events (start_at, end_at) WHERE deleted_at IS NULL;

-- Files people drop in (Inbox first). Kept in the database, capped at 4 MB each.
CREATE TABLE IF NOT EXISTS files (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  mime           text        NOT NULL,
  size_bytes     integer     NOT NULL CHECK (size_bytes BETWEEN 1 AND 4194304),
  sha256         text        NOT NULL,
  data           bytea       NOT NULL,
  owner_user_id  text        NOT NULL DEFAULT 'avihu' REFERENCES users (id),
  scope          text        NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'shared')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE TABLE IF NOT EXISTS inbox_items (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text              text        CHECK (char_length(raw_text) <= 4000),
  file_id               uuid        REFERENCES files (id),
  created_by            text        NOT NULL DEFAULT 'avihu' REFERENCES users (id),
  scope                 text        NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'shared')),
  status                text        NOT NULL DEFAULT 'unclassified' CHECK (status IN ('unclassified', 'classified')),
  classified_domain     text        REFERENCES areas (id),
  classified_branch     text,
  classified_location   text,
  classified_module     text        CHECK (classified_module IN ('task', 'note', 'document')),
  classified_object_id  uuid,
  classified_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CHECK (raw_text IS NOT NULL OR file_id IS NOT NULL),
  FOREIGN KEY (classified_domain, classified_branch)   REFERENCES branches (domain, branch),
  FOREIGN KEY (classified_branch, classified_location) REFERENCES locations (branch, location)
);
CREATE INDEX IF NOT EXISTS idx_inbox_open ON inbox_items (created_at) WHERE status = 'unclassified' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS activity_log (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        text        REFERENCES users (id),
  object_type    text        NOT NULL,
  object_id      text        NOT NULL,
  action         text        NOT NULL,
  metadata_json  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_object ON activity_log (object_type, object_id);

-- Already built and kept: goals and the shared household book (screens from the earlier round).
CREATE TABLE IF NOT EXISTS goals (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  domain         text          NOT NULL REFERENCES areas (id),
  branch         text,
  location       text,
  title          text          NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  unit           text          NOT NULL DEFAULT 'ils' CHECK (unit IN ('ils', 'count', 'pct')),
  target         numeric(14,2),
  current        numeric(14,2),
  due            date,
  status         text          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'dropped')),
  owner_user_id  text          NOT NULL DEFAULT 'avihu' REFERENCES users (id),
  scope          text          NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'shared')),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  FOREIGN KEY (domain, branch)   REFERENCES branches (domain, branch),
  FOREIGN KEY (branch, location) REFERENCES locations (branch, location)
);
CREATE INDEX IF NOT EXISTS idx_goals_place ON goals (domain, branch, location) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS money_entries (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  domain         text          NOT NULL DEFAULT 'personal' CHECK (domain = 'personal'),
  book           text          NOT NULL DEFAULT 'shared',
  kind           text          NOT NULL CHECK (kind IN ('income', 'expense')),
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  category       text          NOT NULL CHECK (char_length(category) BETWEEN 1 AND 60),
  occurred_on    date          NOT NULL,
  note           text          CHECK (char_length(note) <= 500),
  owner_user_id  text          NOT NULL DEFAULT 'avihu' REFERENCES users (id),
  scope          text          NOT NULL DEFAULT 'shared' CHECK (scope IN ('user', 'shared')),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_money_entries_month ON money_entries (book, occurred_on) WHERE deleted_at IS NULL;

ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_mappings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE events               ENABLE ROW LEVEL SECURITY;
ALTER TABLE files                ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals                ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_entries        ENABLE ROW LEVEL SECURITY;
