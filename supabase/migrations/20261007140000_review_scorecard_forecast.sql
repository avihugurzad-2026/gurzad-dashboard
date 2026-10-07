-- Migration: weekly review, Scorecard, cash forecast history (DASHBOARD-SPEC-v2 §3, stage 1.5)
-- Applied to gurzad-all-in-one on 2026-10-07 via the Supabase connector as "review_scorecard_forecast"; rename this file to the version Supabase recorded if it differs.
-- Only creates new tables and seeds the starting Scorecard; nothing existing changes.

CREATE TABLE IF NOT EXISTS scorecard_measures (
  key            text    PRIMARY KEY,
  domain         text    NOT NULL,
  branch         text    NOT NULL,
  name_he        text    NOT NULL,
  owner          text,
  weekly_goal    numeric,                         -- NULL = goal not set yet (no on/off status)
  direction      text    NOT NULL CHECK (direction IN ('higher_better', 'lower_better')),
  effective_from date,
  locked_until   date,                            -- goals change only via quarterly planning before this
  source_kpi     text,                            -- kpi_snapshots.kpi_key (defaults to key)
  sort           int     NOT NULL DEFAULT 100,
  active         boolean NOT NULL DEFAULT true
);

-- Decisions must carry text + owner + week; enforced in the API, shape checked here
CREATE TABLE IF NOT EXISTS weekly_reviews (
  id            bigserial   PRIMARY KEY,
  reviewed_at   timestamptz NOT NULL DEFAULT now(),
  period        text        NOT NULL,             -- ISO week reviewed, 'YYYY-Www'
  trough_week   date,
  trough_amount numeric,
  decisions     jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(decisions) = 'array'),
  notes         text
);

CREATE INDEX IF NOT EXISTS idx_weekly_reviews_reviewed ON weekly_reviews (reviewed_at DESC);

-- One forecast per sync week per scenario, to compare last week's forecast with actual cash
CREATE TABLE IF NOT EXISTS cash_forecast_snapshots (
  id            bigserial   PRIMARY KEY,
  taken_at      timestamptz NOT NULL DEFAULT now(),
  period        text        NOT NULL,             -- ISO week the forecast was taken
  week_start    date        NOT NULL,
  scenario      text        NOT NULL CHECK (scenario IN ('base', 'late_collection', 'lose_top_client')),
  expected_in   numeric,
  expected_out  numeric,
  closing_cash  numeric,
  UNIQUE (period, week_start, scenario)
);

ALTER TABLE scorecard_measures      ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_reviews          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_forecast_snapshots ENABLE ROW LEVEL SECURITY;

-- Starting Scorecard (v2 §5.2). Goals are [estimate]: only the explicit "target 0" ones are
-- set; the rest stay NULL until avihu sets them after ~4 weeks of data.
INSERT INTO scorecard_measures (key, domain, branch, name_he, owner, weekly_goal, direction, effective_from, locked_until, source_kpi, sort) VALUES
  ('cash_operating',           '_all',     '_all',     'מזומן נגיש',                          'אביהו', NULL, 'higher_better', '2026-10-07', NULL,         'cash_operating',           10),
  ('mrr',                      'business', 'adigital', 'MRR אדיג׳יטל (ללא מע"מ)',             'אביהו', NULL, 'higher_better', '2026-10-07', NULL,         'mrr',                      20),
  ('open_debts',               'business', 'adigital', 'חובות פתוחים (כולל מע"מ)',            'אביהו', NULL, 'lower_better',  '2026-10-07', NULL,         'open_debts',               30),
  ('overdue_debt_30',          '_all',     '_all',     'חוב באיחור מעל 30 יום (כולל מע"מ)',   'אביהו', 0,    'lower_better',  '2026-10-07', '2027-01-06', 'overdue_debt_30',          40),
  ('allocation_missing_count', '_all',     '_all',     'חשבוניות מעל הסף בלי מספר הקצאה',      'אביהו', 0,    'lower_better',  '2026-10-07', '2027-01-06', 'allocation_missing_count', 50),
  ('concentration_max_pct',    'business', 'adigital', 'ריכוז הלקוח המוביל (%)',               'אביהו', NULL, 'lower_better',  '2026-10-07', NULL,         'concentration_max_pct',    60),
  ('overdue_tasks',            '_all',     '_all',     'משימות באיחור',                        'אביהו', 0,    'lower_better',  '2026-10-07', '2027-01-06', 'overdue_tasks',            70)
ON CONFLICT (key) DO NOTHING;
