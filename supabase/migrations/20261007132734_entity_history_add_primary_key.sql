-- Migration: primary key for entity_history
-- Applied to the Supabase project (gurzad-all-in-one) on 2026-10-07 through the
-- Supabase connector; this file matches it (same version in the migration history).
-- Safe to re-run: IF NOT EXISTS skips the column (and its key) when present.

ALTER TABLE public.entity_history
  ADD COLUMN IF NOT EXISTS id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY;
