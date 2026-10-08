-- Migration 0006: v2 alert parameters (DASHBOARD-SPEC-v2 §4, §6)
-- Run AFTER 20261007134338_snapshots_alerts. Bootstrap values only, all confidence 'estimate'.
-- The vault's Parameters/thresholds.md is the source of truth: once the same keys
-- are added there (docs/vault-templates/thresholds-additions.md), sync overwrites these.

INSERT INTO parameters (key, effective_from, value, source, confidence) VALUES
  ('cash_floor_months',          '2000-01-01', '{"value": 1.5}', 'seed:DASHBOARD-SPEC-v2 §4.4', 'estimate'),
  ('weeks_of_spend_orange',      '2000-01-01', '{"value": 6}',   'seed:DASHBOARD-SPEC-v2 §6',   'estimate'),
  ('weeks_of_spend_red',         '2000-01-01', '{"value": 4}',   'seed:DASHBOARD-SPEC-v2 §6',   'estimate'),
  ('forecast_variance_pct',      '2000-01-01', '{"value": 10}',  'seed:DASHBOARD-SPEC-v2 §6',   'estimate'),
  ('review_stale_days',          '2000-01-01', '{"value": 9}',   'seed:DASHBOARD-SPEC-v2 §5.1', 'estimate'),
  ('valuation_stale_months',     '2000-01-01', '{"value": 12}',  'seed:DASHBOARD-SPEC-v2 §5.4', 'estimate'),
  ('alert_owner_default',        '2000-01-01', '{"value": "אביהו"}', 'seed:DASHBOARD-SPEC-v2 §6', 'estimate'),
  ('action_allocation_missing',  '2000-01-01', '{"value": "בקש מספר הקצאה לפני הנפקה"}', 'seed:DASHBOARD-SPEC-v2 §6', 'estimate'),
  ('action_overdue_debt',        '2000-01-01', '{"value": "שלח תזכורת + שיחה ללקוח"}',  'seed:DASHBOARD-SPEC-v2 §6', 'estimate'),
  ('action_task_overdue',        '2000-01-01', '{"value": "טפל במשימה או קבע תאריך חדש"}', 'seed:DASHBOARD-SPEC-v2 §6', 'estimate'),
  ('action_cash_below_floor',    '2000-01-01', '{"value": "הקפא הוצאות לא חיוניות"}',   'seed:DASHBOARD-SPEC-v2 §6', 'estimate'),
  ('action_stale_data',          '2000-01-01', '{"value": "הרץ סנכרון"}',               'seed:DASHBOARD-SPEC-v2 §6', 'estimate')
ON CONFLICT DO NOTHING;
