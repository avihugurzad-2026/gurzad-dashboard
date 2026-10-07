-- Migration 0003: Seed Parameters
-- Run AFTER 0002.
--
-- Values MUST match the Obsidian vault's Parameters/ files (source of truth).
-- Verified against:
--   Parameters/vat-rates.md          (from 2015-10-01: 17%, from 2025-01-01: 18%)
--   Parameters/allocation-thresholds.md (gov.il thresholds, high confidence)
--   Parameters/thresholds.md         (alert defaults, confidence: estimate)
--
-- ON CONFLICT DO NOTHING: sync-from-obsidian.js will overwrite these on first
-- run (it is the live source of truth). The seed only bootstraps a fresh DB.

INSERT INTO parameters (key, effective_from, value, source, confidence) VALUES
  -- מע"מ
  ('vat_rate', '2015-10-01', '{"rate": 0.17}', 'vault:Parameters/vat-rates.md', 'fact'),
  ('vat_rate', '2025-01-01', '{"rate": 0.18}', 'vault:Parameters/vat-rates.md', 'fact'),
  -- סף מספר הקצאה (לפני מע"מ)
  ('allocation_threshold', '2024-05-01', '{"amount": 25000}', 'vault:Parameters/allocation-thresholds.md', 'fact'),
  ('allocation_threshold', '2025-01-01', '{"amount": 20000}', 'vault:Parameters/allocation-thresholds.md', 'fact'),
  ('allocation_threshold', '2026-01-01', '{"amount": 10000}', 'vault:Parameters/allocation-thresholds.md', 'fact'),
  ('allocation_threshold', '2026-06-01', '{"amount":  5000}', 'vault:Parameters/allocation-thresholds.md', 'fact'),
  -- ספי התראה (הערכה — לכוון אחרי חודש שימוש)
  ('overdue_red_days',              '2000-01-01', '{"value": 30}',  'vault:Parameters/thresholds.md', 'estimate'),
  ('stale_days',                    '2000-01-01', '{"value": 3}',   'vault:Parameters/thresholds.md', 'estimate'),
  ('client_concentration_warn_pct', '2000-01-01', '{"value": 40}',  'vault:Parameters/thresholds.md', 'estimate'),
  ('partner_loan_warn',             '2000-01-01', '{"value": 80000}','vault:Parameters/thresholds.md','estimate')
ON CONFLICT DO NOTHING;

INSERT INTO branches (domain, branch, name_he, sort) VALUES
  ('business', 'adigital',        'אדיג׳יטל',       1),
  ('business', 'head-spa-israel', 'OSPA',            2),
  ('personal', 'home',            'בית',             1),
  ('personal', 'general-tasks',   'משימות כלליות',   2),
  ('ventures', 'real-estate',     'נדל״ן',           1),
  ('ventures', 'legal-and-tasks', 'משפטי',           2),
  ('ventures', 'investments',     'השקעות',          3),
  ('ventures', 'finance',         'פיננסים',         4)
ON CONFLICT DO NOTHING;
