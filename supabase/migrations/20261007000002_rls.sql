-- Migration 0002: Row Level Security
-- Run AFTER 0001.
--
-- Enabling RLS with NO policies blocks all access via Supabase REST API
-- (anon and authenticated roles see zero rows). Our server uses a direct
-- pg Pool (postgres superuser role) which bypasses RLS, so the API works
-- normally. The service_role JWT also bypasses RLS by default.
--
-- This prevents anyone who gets hold of the anon/public key from reading
-- the database directly through the Supabase REST endpoint.

ALTER TABLE parameters     ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_history ENABLE ROW LEVEL SECURITY;
