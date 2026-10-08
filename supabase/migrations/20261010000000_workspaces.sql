-- Multi-user / multi-workspace layer.
--
--   USER → WORKSPACES → MEMBERS → MODULES → DATA
--
-- A workspace is one of: personal (exactly one per user, private to its owner), household (shared),
-- business (one per business; its branches are `locations` rows) or ventures. Every data table gets a
-- `workspace_id`, filled by a trigger from the row's place (domain/branch) and owner, so existing code
-- that writes domain/branch keeps working and every row still ends up in exactly one workspace.
--
-- Places stay as they are: business rows are (business, <business id>, <branch id>); a household is
-- (household, <household id>); personal rows are (personal, NULL) and belong to the personal
-- workspace of their owner_user_id. `branches` is the registry of businesses / households / venture
-- areas (domain + id), `locations` is the registry of a business's branches. Nothing here deletes data.

BEGIN;

-- ── Areas: the household is its own area ─────────────────────────────────────
ALTER TABLE areas DROP CONSTRAINT IF EXISTS areas_id_check;
ALTER TABLE areas ADD CONSTRAINT areas_id_check CHECK (id IN ('business', 'personal', 'ventures', 'household'));
INSERT INTO areas (id, name_he, sort) VALUES ('household', 'משק בית', 2) ON CONFLICT (id) DO NOTHING;
UPDATE categories SET domain = 'household' WHERE id = 'home';

-- The registry rows (businesses, households, venture areas) can be added, renamed and archived from the UI
ALTER TABLE branches ADD COLUMN IF NOT EXISTS active     boolean     NOT NULL DEFAULT true;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- ── Users ─────────────────────────────────────────────────────────────────────
-- Self-registration creates ids from the e-mail; keep the existing format check
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (lower(email)) WHERE email IS NOT NULL;

-- ── Workspaces ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text        NOT NULL CHECK (kind IN ('personal', 'household', 'business', 'ventures')),
  name           text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  owner_user_id  text        NOT NULL REFERENCES users (id),
  domain         text        NOT NULL REFERENCES areas (id),
  branch         text,                                        -- business / household id in `branches`
  sort           int,
  created_by     text        REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CHECK (domain = CASE kind WHEN 'personal' THEN 'personal' WHEN 'household' THEN 'household'
                            WHEN 'business' THEN 'business' ELSE 'ventures' END),
  CHECK ((kind IN ('business', 'household')) = (branch IS NOT NULL)),
  FOREIGN KEY (domain, branch) REFERENCES branches (domain, branch)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ws_personal ON workspaces (owner_user_id) WHERE kind = 'personal' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ws_place    ON workspaces (domain, branch) WHERE branch IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ws_ventures ON workspaces (kind) WHERE kind = 'ventures' AND deleted_at IS NULL;

-- Memberships: a membership row now names its workspace. Business memberships may still narrow
-- to one branch (location). Household roles: owner / admin / member / viewer.
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces (id);
ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS workspace_members_role_check;
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'member', 'employee', 'viewer'));
CREATE INDEX IF NOT EXISTS idx_members_ws ON workspace_members (workspace_id, user_id) WHERE revoked_at IS NULL;

ALTER TABLE invitations ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces (id);
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_role_check CHECK (role IN ('admin', 'manager', 'member', 'employee', 'viewer'));

-- ── Seed from today's data (idempotent) ───────────────────────────────────────
-- The first household: today's shared household book and the "בית" task list move into it.
INSERT INTO branches (domain, branch, name_he, sort) VALUES ('household', 'home', 'הבית שלנו', 1)
ON CONFLICT (domain, branch) DO NOTHING;

-- One personal workspace per user
INSERT INTO workspaces (kind, name, owner_user_id, domain, created_by)
SELECT 'personal', 'אישי – ' || u.name, u.id, 'personal', u.id FROM users u
WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.kind = 'personal' AND w.owner_user_id = u.id AND w.deleted_at IS NULL);

-- The account owner's shared workspaces: the household, each business, ventures
INSERT INTO workspaces (kind, name, owner_user_id, domain, branch, sort, created_by)
SELECT CASE b.domain WHEN 'household' THEN 'household' ELSE 'business' END,
       CASE b.branch WHEN 'adigital' THEN 'a-digital' WHEN 'head-spa-israel' THEN 'Head Spa Israel' ELSE coalesce(b.name_he, b.branch) END,
       o.user_id, b.domain, b.branch, b.sort, o.user_id
FROM branches b
CROSS JOIN (SELECT user_id FROM workspace_members WHERE role = 'owner' AND domain IS NULL AND revoked_at IS NULL ORDER BY created_at LIMIT 1) o
WHERE b.domain IN ('business', 'household')
  AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.domain = b.domain AND w.branch = b.branch AND w.deleted_at IS NULL);

INSERT INTO workspaces (kind, name, owner_user_id, domain, created_by)
SELECT 'ventures', 'יזמות', o.user_id, 'ventures', o.user_id
FROM (SELECT user_id FROM workspace_members WHERE role = 'owner' AND domain IS NULL AND revoked_at IS NULL ORDER BY created_at LIMIT 1) o
WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE kind = 'ventures' AND deleted_at IS NULL);

-- A new user gets their personal workspace at once, whichever path created them (invitation, admin)
CREATE OR REPLACE FUNCTION app_create_personal_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO workspaces (kind, name, owner_user_id, domain, created_by)
  SELECT 'personal', 'אישי – ' || NEW.name, NEW.id, 'personal', NEW.id
  WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE kind = 'personal' AND owner_user_id = NEW.id AND deleted_at IS NULL);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_users_personal_ws ON users;
CREATE TRIGGER trg_users_personal_ws AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION app_create_personal_workspace();

-- Every workspace owner is an owner member of it
INSERT INTO workspace_members (user_id, role, domain, branch, workspace_id, created_by)
SELECT w.owner_user_id, 'owner', w.domain, w.branch, w.id, w.owner_user_id FROM workspaces w
WHERE w.deleted_at IS NULL AND w.kind <> 'personal'
  AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = w.owner_user_id AND m.revoked_at IS NULL);

-- Existing place memberships point at their workspace. A membership of the old personal area
-- (shared household book) becomes a household membership: the personal area is now private.
UPDATE workspace_members m SET domain = 'household', branch = 'home',
       role = CASE WHEN m.role IN ('manager', 'employee') THEN 'member' ELSE m.role END
WHERE m.domain = 'personal' AND m.revoked_at IS NULL;
UPDATE workspace_members m SET workspace_id = w.id FROM workspaces w
WHERE m.workspace_id IS NULL AND m.domain IS NOT NULL AND w.deleted_at IS NULL AND w.domain = m.domain
  AND (w.branch = m.branch OR (w.kind = 'ventures') OR (w.kind = 'household' AND m.branch IS NULL));
UPDATE invitations SET domain = 'household', branch = 'home', role = CASE WHEN role IN ('manager', 'employee') THEN 'member' ELSE role END
WHERE domain = 'personal' AND accepted_at IS NULL AND revoked_at IS NULL;

-- ── Move household data into the household area ───────────────────────────────
-- The shared household book (shared personal transactions) and the "בית" tasks
UPDATE transactions SET domain = 'household', branch = 'home', location = NULL
WHERE domain = 'personal' AND scope = 'shared' AND classification = 'personal';
UPDATE work_items SET domain = 'household', branch = 'home', location = NULL, scope = 'shared'
WHERE domain = 'personal' AND category_id = 'home';

-- ── workspace_id on every data table ──────────────────────────────────────────
-- Which workspace a place + owner belongs to
CREATE OR REPLACE FUNCTION app_workspace_for(p_domain text, p_branch text, p_owner text) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT w.id FROM workspaces w
  WHERE w.deleted_at IS NULL AND w.domain = p_domain
    AND CASE w.kind
          WHEN 'personal'  THEN w.owner_user_id = p_owner
          WHEN 'ventures'  THEN true
          ELSE w.branch = p_branch
        END
  ORDER BY w.created_at LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app_set_workspace_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS NULL OR TG_OP = 'UPDATE' THEN
    NEW.workspace_id := coalesce(
      app_workspace_for(NEW.domain, NEW.branch, NEW.owner_user_id),
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.workspace_id END);
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_items', 'goals', 'transactions', 'documents', 'receivables', 'events',
                           'assets', 'liabilities', 'investments', 'legal_cases', 'contacts'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces (id)', t);
    EXECUTE format('UPDATE %I SET workspace_id = app_workspace_for(domain, branch, owner_user_id) WHERE workspace_id IS NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (workspace_id)', 'idx_' || t || '_ws', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_ws ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_ws BEFORE INSERT OR UPDATE OF domain, branch, owner_user_id ON %I
                    FOR EACH ROW EXECUTE FUNCTION app_set_workspace_id()', t, t);
  END LOOP;
END $$;

-- Places without an owner column: integrations and alerts belong to the workspace of their place
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integrations', 'alerts'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces (id)', t);
    EXECUTE format('UPDATE %I SET workspace_id = app_workspace_for(domain, branch, NULL) WHERE workspace_id IS NULL AND domain IS NOT NULL', t);
  END LOOP;
END $$;

-- The people on a row, under the names the product uses (same values as owner / created_by / assigned_to)
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS created_by_user_id text REFERENCES users (id);
UPDATE work_items SET created_by_user_id = owner_user_id WHERE created_by_user_id IS NULL;

-- ── Authorization helpers (also used by the RLS policies below) ───────────────
-- Personal workspace: its owner only. Others: an active membership (any role reads).
CREATE OR REPLACE FUNCTION app_can_read_workspace(p_ws uuid, p_user text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspaces w
    WHERE w.id = p_ws AND w.deleted_at IS NULL
      AND (w.owner_user_id = p_user
           OR (w.kind <> 'personal' AND EXISTS (
                 SELECT 1 FROM workspace_members m
                 WHERE m.workspace_id = w.id AND m.user_id = p_user AND m.revoked_at IS NULL))))
$$;

-- ── Row Level Security, prepared ──────────────────────────────────────────────
-- The server talks to Postgres with a role that bypasses RLS and enforces the same rules in code
-- (src/server/auth.ts). These policies make a direct, per-user connection safe as well: such a
-- connection sets `app.user_id` and sees only the workspaces it belongs to.
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN RETURN; END IF;  -- not Supabase (local tests)
  DROP POLICY IF EXISTS ws_read ON workspaces;
  CREATE POLICY ws_read ON workspaces FOR SELECT TO authenticated
    USING (app_can_read_workspace(id, current_setting('app.user_id', true)));
  FOREACH t IN ARRAY ARRAY['work_items', 'goals', 'transactions', 'documents', 'receivables', 'events',
                           'assets', 'liabilities', 'investments', 'legal_cases', 'contacts', 'integrations', 'alerts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS ws_isolation ON %I', t);
    EXECUTE format('CREATE POLICY ws_isolation ON %I FOR ALL TO authenticated
                    USING (app_can_read_workspace(workspace_id, current_setting(''app.user_id'', true)))
                    WITH CHECK (app_can_read_workspace(workspace_id, current_setting(''app.user_id'', true)))', t);
  END LOOP;
END $$;

COMMIT;
