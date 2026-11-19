-- Gurzad dashboard v3.2 — push notifications + live sync. Additive only, gd_ prefix (shared project).
-- Rollback: drop table gd_push_subscriptions, gd_notify_log; alter publication supabase_realtime drop table gd_records.

-- One row per installed device/browser. Written only by /api/push (service role).
create table if not exists gd_push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references gd_workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  prefs        jsonb not null default '{"areas":["home","business","invest"],"urgentOnly":false}',
  device       text,
  created_at   timestamptz not null default now(),
  last_ok_at   timestamptz,
  fail_count   int not null default 0
);
create index if not exists idx_gd_push_ws on gd_push_subscriptions (workspace_id);
create index if not exists idx_gd_push_user on gd_push_subscriptions (user_id);

-- What was already pushed, so the daily run only sends what is new (and re-reminds urgent items every 3 days).
create table if not exists gd_notify_log (
  workspace_id  uuid not null references gd_workspaces(id) on delete cascade,
  alert_id      text not null,
  level         text not null,
  first_sent_at timestamptz not null default now(),
  last_sent_at  timestamptz not null default now(),
  primary key (workspace_id, alert_id)
);

alter table gd_push_subscriptions enable row level security;
alter table gd_notify_log         enable row level security;  -- no policies: service role only
drop policy if exists gd_push_read on gd_push_subscriptions;
create policy gd_push_read on gd_push_subscriptions for select to authenticated using (user_id = (select auth.uid()));

-- Indexes for the foreign keys of the first migration (advisor: unindexed foreign keys)
create index if not exists idx_gd_memberships_user on gd_memberships (user_id);
create index if not exists idx_gd_invites_email on gd_invites (email);

-- Live sync between devices and members: the app listens to changes on gd_records (RLS still applies).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'gd_records') then
    alter publication supabase_realtime add table gd_records;
  end if;
end $$;
