-- Security hardening (2026-11-19). Touches only gd_ objects (the Supabase project is shared).
-- Rollback: re-run gd_area_of from 20261117000002_gd_planner.sql; grant select,insert,update,delete on the gd_ tables back to anon.

-- 1) The WhatsApp agent's chat log and pending receipts are the owner's private conversation:
--    area 'owner' is in nobody's areas list, so only the owner (and the server) can read them.
create or replace function gd_area_of(collection text) returns text language sql immutable set search_path = public as $$
  select case
    when collection in ('home_tasks','shopping','transactions','budgets','bills','maintenance','documents','events') then 'home'
    when collection in ('businesses','invoices','clients','biz_expenses','biz_tasks','integrations') then 'business'
    when collection in ('properties','tenants','leases','rent_payments','prop_tasks','photos','alert_rules') then 'invest'
    when collection in ('wa_messages','wa_pending') then 'owner'
    else 'shared'  -- monitors, members, parameters, settings
  end $$;

-- 2) Defense in depth: signed-out visitors (anon key) get no table privileges at all on dashboard tables,
--    so even a future policy mistake cannot expose them without a login.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'gd\_%' loop
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end $$;
