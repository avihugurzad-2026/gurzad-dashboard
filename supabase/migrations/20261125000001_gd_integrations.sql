-- Gurzad dashboard — per-business integrations (Buyz, Morning, ...).
-- Additive, gd_ prefix only (shared project). Rollback: drop table gd_integration_snapshots, gd_integration_connections;
-- Secrets are AES-256-GCM sealed by the server (INTEGRATIONS_KEY). RLS on with no policies: service role only.

create table if not exists gd_integration_connections (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references gd_workspaces(id) on delete cascade,
  business_id  text not null references gd_records(id) on delete cascade,
  provider     text not null,
  config       jsonb not null default '{}',
  secret_enc   text not null default '',
  key_hint     text,
  status       text not null default 'connected',
  last_sync_at timestamptz,
  last_error   text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (workspace_id, business_id, provider)
);
alter table gd_integration_connections enable row level security;

create table if not exists gd_integration_snapshots (
  connection_id uuid not null references gd_integration_connections(id) on delete cascade,
  kind          text not null,
  data          jsonb not null default '{}',
  fetched_at    timestamptz not null default now(),
  primary key (connection_id, kind)
);
alter table gd_integration_snapshots enable row level security;
