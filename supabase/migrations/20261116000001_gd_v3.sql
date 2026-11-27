-- Gurzad dashboard v3 — schema. ALL objects are prefixed gd_ because this Supabase project
-- (gurzad-all-in-one) is shared with other apps (lms_*, besti_*, eden_*, masa_*, and an older
-- workspaces/* design). This migration is additive only:
--   * creates gd_* tables, gd_* functions, one private storage bucket (gd-property-photos)
--   * does NOT alter or drop anything existing, and adds NO trigger on auth.users
--     (auth.users is shared; membership is handled by /api/auth/* instead).
-- Rollback: drop the gd_* tables/functions and the bucket policies named gd_*.

create table if not exists gd_workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'הדשבורד שלי',
  owner_id    uuid not null references auth.users(id),
  created_at  timestamptz not null default now()
);

create table if not exists gd_memberships (
  workspace_id uuid not null references gd_workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('owner','editor','viewer')),
  areas        text[] not null default '{home,business,invest}',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists gd_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references gd_workspaces(id) on delete cascade,
  email        text not null,
  name         text,
  role         text not null check (role in ('editor','viewer')),
  areas        text[] not null,
  invited_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  unique (workspace_id, email)
);

-- Email OTP codes (hashed). Only the service role touches this table.
create table if not exists gd_otp (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_gd_otp_email on gd_otp (email, created_at desc);

create table if not exists gd_records (
  id           text primary key,
  workspace_id uuid not null references gd_workspaces(id) on delete cascade,
  collection   text not null,
  data         jsonb not null default '{}',
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_gd_records_ws_collection on gd_records (workspace_id, collection);

create or replace function gd_touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_gd_records_touch on gd_records;
create trigger trg_gd_records_touch before update on gd_records for each row execute function gd_touch_updated_at();

-- Which area does a collection belong to? 'shared' = every member reads, only the owner writes.
create or replace function gd_area_of(collection text) returns text language sql immutable set search_path = public as $$
  select case
    when collection in ('home_tasks','shopping','transactions','budgets','bills','maintenance','documents') then 'home'
    when collection in ('businesses','invoices','clients','biz_expenses','biz_tasks','integrations') then 'business'
    when collection in ('properties','tenants','leases','rent_payments','prop_tasks','photos','alert_rules') then 'invest'
    else 'shared'  -- monitors, wa_messages, members, parameters
  end $$;

create or replace function gd_my_role(ws uuid) returns text language sql stable security definer set search_path = public as $$
  select role from gd_memberships where workspace_id = ws and user_id = auth.uid() $$;
create or replace function gd_can_read(ws uuid, collection text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from gd_memberships m where m.workspace_id = ws and m.user_id = auth.uid()
    and (gd_area_of(collection) = 'shared' or m.role = 'owner' or gd_area_of(collection) = any(m.areas))) $$;
create or replace function gd_can_write(ws uuid, collection text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from gd_memberships m where m.workspace_id = ws and m.user_id = auth.uid()
    and (m.role = 'owner' or (m.role = 'editor' and gd_area_of(collection) = any(m.areas)))) $$;
revoke execute on function gd_my_role(uuid), gd_can_read(uuid, text), gd_can_write(uuid, text) from anon, public;
grant execute on function gd_my_role(uuid), gd_can_read(uuid, text), gd_can_write(uuid, text) to authenticated;

alter table gd_workspaces  enable row level security;
alter table gd_memberships enable row level security;
alter table gd_invites     enable row level security;
alter table gd_otp         enable row level security;  -- no policies: service role only
alter table gd_records     enable row level security;

drop policy if exists gd_ws_read on gd_workspaces;
create policy gd_ws_read on gd_workspaces for select to authenticated using (gd_my_role(id) is not null);
drop policy if exists gd_mem_read on gd_memberships;
create policy gd_mem_read on gd_memberships for select to authenticated using (user_id = auth.uid() or gd_my_role(workspace_id) = 'owner');
drop policy if exists gd_inv_read on gd_invites;
create policy gd_inv_read on gd_invites for select to authenticated using (gd_my_role(workspace_id) = 'owner');
-- memberships and invites are written only by the server (/api/invite, /api/auth/verify-otp).

drop policy if exists gd_rec_read on gd_records;
create policy gd_rec_read on gd_records for select to authenticated using (gd_can_read(workspace_id, collection));
drop policy if exists gd_rec_insert on gd_records;
create policy gd_rec_insert on gd_records for insert to authenticated with check (gd_can_write(workspace_id, collection));
drop policy if exists gd_rec_update on gd_records;
create policy gd_rec_update on gd_records for update to authenticated using (gd_can_write(workspace_id, collection)) with check (gd_can_write(workspace_id, collection));
drop policy if exists gd_rec_delete on gd_records;
create policy gd_rec_delete on gd_records for delete to authenticated using (gd_can_write(workspace_id, collection));

-- Property photos (private bucket; object path = <workspace_id>/<property_id>/<file>)
insert into storage.buckets (id, name, public) values ('gd-property-photos', 'gd-property-photos', false) on conflict (id) do nothing;
drop policy if exists gd_photos_read on storage.objects;
create policy gd_photos_read on storage.objects for select to authenticated using (bucket_id = 'gd-property-photos' and gd_can_read(((storage.foldername(name))[1])::uuid, 'photos'));
drop policy if exists gd_photos_write on storage.objects;
create policy gd_photos_write on storage.objects for insert to authenticated with check (bucket_id = 'gd-property-photos' and gd_can_write(((storage.foldername(name))[1])::uuid, 'photos'));
drop policy if exists gd_photos_delete on storage.objects;
create policy gd_photos_delete on storage.objects for delete to authenticated using (bucket_id = 'gd-property-photos' and gd_can_write(((storage.foldername(name))[1])::uuid, 'photos'));
