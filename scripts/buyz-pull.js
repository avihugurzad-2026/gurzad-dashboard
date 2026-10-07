#!/usr/bin/env node
// Pull monthly revenue from Buyz (Head Spa Israel) into revenue_monthly + kpi_snapshots.
// Usage: node scripts/buyz-pull.js [--apply] [--months N]   (default: dry run, 24 months)
// Never requests transactions (customer names). The key is read from BUYZ_API_KEY only.
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const { ingestBuyz } = require('../lib/revenue');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const MONTHS = args.includes('--months') ? Number(args[args.indexOf('--months') + 1]) : 24;

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set in .env'); process.exit(1); }
if (!process.env.BUYZ_API_KEY) { console.error('BUYZ_API_KEY not set in .env'); process.exit(1); }
if (!(MONTHS >= 1 && MONTHS <= 24)) { console.error('--months must be 1..24'); process.exit(1); }

const ssl = /sslmode=disable/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false };
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });

ingestBuyz(pool, { key: process.env.BUYZ_API_KEY, query: { months: MONTHS }, dry: !APPLY })
  .then(r => {
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN (nothing written)'} · Buyz account ${r.account}`);
    console.log(`months: ${r.months} · added ${r.added} · changed ${r.changed} · unchanged ${r.unchanged} · snapshots ${r.snapshots}`);
    if (!APPLY) console.log('Run with --apply to write.');
  })
  .catch(e => { console.error('Failed:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
