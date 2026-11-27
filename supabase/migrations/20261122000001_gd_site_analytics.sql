-- Gurzad dashboard v3 — First-party site analytics & conversions table.
-- Additive only; prefixed gd_ because this Supabase project is shared.
-- Rollback: drop table if exists gd_site_events;

create table if not exists gd_site_events (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references gd_workspaces(id) on delete cascade,
  site_id           text not null,
  kind              text not null check (kind in ('pageview', 'conversion')),
  visitor_id        text not null,
  session_id        text not null,
  is_new            boolean not null default true,
  path              text not null default '/',
  title             text,
  referrer          text,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  gclid             text,
  device            text check (device in ('mobile', 'desktop', 'tablet')),
  browser           text,
  country           text,
  duration_sec      int not null default 0,
  conversion_id     text,
  conversion_name   text,
  conversion_value  numeric(12,2),
  from_ads          boolean not null default false,
  google_sent       boolean not null default false,
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz not null default now()
);

create index if not exists idx_gd_site_events_ws_time
  on gd_site_events (workspace_id, created_at desc);

create index if not exists idx_gd_site_events_site_time
  on gd_site_events (site_id, created_at desc);

create index if not exists idx_gd_site_events_ws_last_seen
  on gd_site_events (workspace_id, last_seen_at desc);

create index if not exists idx_gd_site_events_session
  on gd_site_events (site_id, session_id, created_at desc);

alter table gd_site_events enable row level security;
revoke all on table gd_site_events from anon;

drop policy if exists gd_site_events_read on gd_site_events;
create policy gd_site_events_read on gd_site_events
  for select to authenticated
  using (gd_can_read(workspace_id, 'monitors'));
