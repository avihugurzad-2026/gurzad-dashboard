-- Gurzad dashboard v3.3 — planner: Google Calendar per user + who may write events/settings.
-- Additive, gd_ prefix only (shared project). Needs 20261116000001 and 20261117000001 first.
-- Rollback: drop table gd_google_tokens; then re-run gd_area_of from 20261116000001.

-- One Google connection per dashboard user. The refresh token is AES-256-GCM encrypted by the server
-- before it is stored; RLS is on with no policies, so only the service role (Vercel functions) can read it.
create table if not exists gd_google_tokens (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  workspace_id      uuid not null references gd_workspaces(id) on delete cascade,
  google_email      text,
  refresh_token_enc text not null,
  push_enabled      boolean not null default true,
  connected_at      timestamptz not null default now(),
  synced_at         timestamptz
);
create index if not exists idx_gd_google_ws on gd_google_tokens (workspace_id);
alter table gd_google_tokens enable row level security;

-- Calendar events belong to the home area, so a family member with "home" access can add them.
-- Reminder templates ("settings") stay shared: everyone reads, only the owner writes.
create or replace function gd_area_of(collection text) returns text language sql immutable set search_path = public as $$
  select case
    when collection in ('home_tasks','shopping','transactions','budgets','bills','maintenance','documents','events') then 'home'
    when collection in ('businesses','invoices','clients','biz_expenses','biz_tasks','integrations') then 'business'
    when collection in ('properties','tenants','leases','rent_payments','prop_tasks','photos','alert_rules') then 'invest'
    else 'shared'  -- monitors, wa_messages, members, parameters, settings
  end $$;
