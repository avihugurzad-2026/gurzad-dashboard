'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const g      = require('../lib/gcal');

// Obviously fake credentials only
const KEY = crypto.randomBytes(32).toString('base64');
const FAKE_REFRESH = 'fake-refresh-token-for-tests';

test('encryptToken/decryptToken: round trip, random IV, v1 format', () => {
  const a = g.encryptToken(FAKE_REFRESH, KEY);
  const b = g.encryptToken(FAKE_REFRESH, KEY);
  assert.match(a, /^v1:[^:]+:[^:]+:[^:]+$/);
  assert.notEqual(a, b);
  assert.ok(!a.includes(FAKE_REFRESH));
  assert.equal(g.decryptToken(a, KEY), FAKE_REFRESH);
});

test('decryptToken: tampering, a wrong key and a bad key length all throw', () => {
  const s = g.encryptToken(FAKE_REFRESH, KEY);
  const [v, iv, tag, ct] = s.split(':');
  const flipped = Buffer.from(ct, 'base64'); flipped[0] ^= 1;
  assert.throws(() => g.decryptToken([v, iv, tag, flipped.toString('base64')].join(':'), KEY), /tampered/);
  assert.throws(() => g.decryptToken(s, crypto.randomBytes(32).toString('base64')), /tampered/);
  assert.throws(() => g.decryptToken('revoked', KEY), /format/);
  assert.throws(() => g.encryptToken('x', Buffer.alloc(16).toString('base64')), /32 bytes/);
  assert.throws(() => g.encryptToken('x', undefined), /32 bytes/);
});

test('authUrl: calendar.events + calendar.readonly, offline, consent, state', () => {
  const u = new URL(g.authUrl({ clientId: 'cid.apps.example', redirectUri: 'https://dash.example/api/google/callback', state: 'st8' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const p = u.searchParams;
  assert.equal(p.get('scope'), 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly');
  assert.equal(p.get('access_type'), 'offline');
  assert.equal(p.get('prompt'), 'consent');
  assert.equal(p.get('include_granted_scopes'), 'true');
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('state'), 'st8');
  assert.equal(p.get('redirect_uri'), 'https://dash.example/api/google/callback');
});

test('toEventRow: timed event → UTC instants', () => {
  const r = g.toEventRow({
    id: 'e1', status: 'confirmed', summary: 'פגישה', location: 'מודיעין', htmlLink: 'https://calendar.google.com/x',
    start: { dateTime: '2026-10-08T10:00:00+03:00', timeZone: 'Asia/Jerusalem' }, end: { dateTime: '2026-10-08T11:30:00+03:00' },
  });
  assert.deepEqual(r, {
    google_event_id: 'e1', title: 'פגישה', start_at: '2026-10-08T07:00:00.000Z', end_at: '2026-10-08T08:30:00.000Z',
    all_day: false, timezone: 'Asia/Jerusalem', place: 'מודיעין', status: 'confirmed', html_link: 'https://calendar.google.com/x',
    description: null, google_etag: null, google_updated_at: null,
  });
});

test('toEventRow: all-day = Israel local midnights, end exclusive, summer and winter time', () => {
  const summer = g.toEventRow({ id: 's', start: { date: '2026-07-15' }, end: { date: '2026-07-16' } });
  assert.equal(summer.all_day, true);
  assert.equal(summer.start_at, '2026-07-14T21:00:00.000Z');   // UTC+3
  assert.equal(summer.end_at, '2026-07-15T21:00:00.000Z');
  const winter = g.toEventRow({ id: 'w', start: { date: '2026-12-01' }, end: { date: '2026-12-03' } });
  assert.equal(winter.start_at, '2026-11-30T22:00:00.000Z');   // UTC+2
  assert.equal(winter.end_at, '2026-12-02T22:00:00.000Z');
  // Spanning the October 2026 switch back to winter time (Sunday 25 Oct)
  const cross = g.toEventRow({ id: 'c', start: { date: '2026-10-24' }, end: { date: '2026-10-26' } });
  assert.equal(cross.start_at, '2026-10-23T21:00:00.000Z');
  assert.equal(cross.end_at, '2026-10-25T22:00:00.000Z');
  assert.equal(g.toEventRow({ id: 'x', summary: 'x', start: { date: '2026-01-01' }, end: { date: '2026-01-02' } }).title, 'x');
});

test('toEventRow: cancelled tombstone (no times) and unsafe link', () => {
  const r = g.toEventRow({ id: 'gone', status: 'cancelled' });
  assert.equal(r.status, 'cancelled');
  assert.equal(r.start_at, null);
  assert.equal(g.toEventRow({ id: 'l', htmlLink: 'javascript:alert(1)', start: { date: '2026-01-01' } }).html_link, null);
});

// ---------- sync with a fake client and a fake Google ----------

function fakeClient() {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (/^INSERT INTO events/.test(sql.trim())) return { rowCount: JSON.parse(params[0]).length, rows: [] };
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
}
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const timed = (id, extra = {}) => ({ id, status: 'confirmed', summary: id, start: { dateTime: '2026-10-08T10:00:00Z' }, end: { dateTime: '2026-10-08T11:00:00Z' }, ...extra });
const mapping = { id: '11111111-1111-4111-8111-111111111111', google_calendar_id: 'me@example.com', domain: 'business', branch: 'head-spa-israel', location: 'modiin', sync_token: null };
const NOW = new Date('2026-10-07T12:00:00Z');

test('syncCalendar: full sync, paginated, window params, upsert on the partial index, orphans removed, token saved', async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url); urls.push(u);
    assert.equal(init.headers.Authorization, 'Bearer fake-access');
    return u.searchParams.get('pageToken') === 'p2'
      ? resp(200, { items: [timed('b'), { id: 'wl', eventType: 'workingLocation', start: { date: '2026-10-08' } }], nextSyncToken: 'sync-1' })
      : resp(200, { items: [timed('a'), timed('b', { summary: 'old' })], nextPageToken: 'p2' });
  };
  const c = fakeClient();
  const out = await g.syncCalendar(c, mapping, 'fake-access', { fetchImpl, now: NOW, ownerUserId: 'avihu' });
  assert.equal(urls.length, 2);
  assert.equal(urls[0].pathname, '/calendar/v3/calendars/me%40example.com/events');
  for (const u of urls) {
    assert.equal(u.searchParams.get('singleEvents'), 'true');
    assert.equal(u.searchParams.get('maxResults'), '250');
    assert.equal(u.searchParams.get('syncToken'), null);
    assert.equal(u.searchParams.get('timeMin'), '2026-08-08T12:00:00.000Z');
    assert.equal(u.searchParams.get('timeMax'), '2027-04-05T12:00:00.000Z');
  }
  assert.deepEqual(out, { calendar: 'me@example.com', full: true, fetched: 4, upserted: 2, removed: 0 });

  const sqls = c.queries.map(q => q.sql);
  assert.equal(sqls[0], 'BEGIN');
  assert.equal(sqls.at(-1), 'COMMIT');
  const ins = c.queries.find(q => q.sql.startsWith('INSERT INTO events'));
  assert.match(ins.sql, /ON CONFLICT \(mapping_id, google_event_id\) WHERE source = 'google' DO UPDATE/);
  const rows = JSON.parse(ins.params[0]);
  assert.deepEqual(rows.map(r => [r.google_event_id, r.title]), [['a', 'a'], ['b', 'b']]);   // last copy of b wins
  assert.deepEqual(ins.params.slice(1), ['me@example.com', mapping.id, 'avihu', 'business', 'head-spa-israel', 'modiin', 'user']);
  const orphan = c.queries.find(q => /NOT \(google_event_id = ANY/.test(q.sql));
  assert.deepEqual(orphan.params[3], ['a', 'b']);
  const save = c.queries.find(q => q.sql.startsWith('UPDATE calendar_mappings'));
  assert.deepEqual(save.params, [mapping.id, 'sync-1']);
});

test('syncCalendar: incremental with syncToken (no time window); cancelled → soft delete', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(new URL(url));
    return resp(200, { items: [timed('a'), { id: 'gone', status: 'cancelled' }], nextSyncToken: 'sync-2' });
  };
  const c = fakeClient();
  const out = await g.syncCalendar(c, { ...mapping, sync_token: 'sync-1' }, 'fake-access', { fetchImpl, now: NOW, ownerUserId: 'avihu' });
  assert.equal(urls[0].searchParams.get('syncToken'), 'sync-1');
  assert.equal(urls[0].searchParams.get('timeMin'), null);
  assert.equal(urls[0].searchParams.get('timeMax'), null);
  assert.equal(out.full, false);
  const del = c.queries.find(q => q.sql.startsWith('UPDATE events SET status = \'cancelled\''));
  assert.match(del.sql, /deleted_at = now\(\)/);
  assert.deepEqual(del.params, [mapping.id, ['gone']]);
  assert.ok(!c.queries.some(q => /NOT \(google_event_id = ANY/.test(q.sql)));   // no orphan sweep on incremental
  assert.deepEqual(c.queries.find(q => q.sql.startsWith('UPDATE calendar_mappings')).params, [mapping.id, 'sync-2']);
});

test('syncCalendar: HTTP 410 on the sync token → full sync', async () => {
  const urls = [];
  const fetchImpl = async url => {
    const u = new URL(url); urls.push(u);
    if (u.searchParams.get('syncToken')) return resp(410, { error: { errors: [{ reason: 'fullSyncRequired' }] } });
    return resp(200, { items: [timed('a')], nextSyncToken: 'fresh' });
  };
  const c = fakeClient();
  const out = await g.syncCalendar(c, { ...mapping, sync_token: 'stale' }, 'fake-access', { fetchImpl, now: NOW, ownerUserId: 'avihu' });
  assert.equal(urls.length, 2);
  assert.ok(urls[1].searchParams.get('timeMin'));
  assert.equal(out.full, true);
  assert.deepEqual(c.queries.find(q => q.sql.startsWith('UPDATE calendar_mappings')).params, [mapping.id, 'fresh']);
});

test('syncCalendar: other HTTP errors throw a safe code and write nothing', async () => {
  const fetchImpl = async () => resp(403, { error: { errors: [{ reason: 'forbidden' }], message: 'secret-ish detail' } });
  const c = fakeClient();
  await assert.rejects(g.syncCalendar(c, mapping, 'fake-access', { fetchImpl, now: NOW, ownerUserId: 'avihu' }), e => e.code === 'forbidden' && !/secret/.test(e.message));
  assert.equal(c.queries.length, 0);
});

function fakePool(mappings) {
  const queries = [];
  const client = fakeClient();
  return {
    queries, client,
    async query(sql, params = []) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (/FROM calendar_mappings/.test(sql)) return { rows: mappings, rowCount: mappings.length };
      return { rows: [], rowCount: 1 };
    },
    async connect() { return client; },
  };
}
const conn = { id: '22222222-2222-4222-8222-222222222222', user_id: 'avihu', refresh_token_encrypted: g.encryptToken(FAKE_REFRESH, KEY) };
const creds = { clientId: 'cid', clientSecret: 'fake-secret', keyB64: KEY };

test('syncConnection: refreshes with the decrypted token, syncs enabled mappings, marks connected', async () => {
  let tokenBody;
  const fetchImpl = async (url, init) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') { tokenBody = new URLSearchParams(init.body); return resp(200, { access_token: 'fake-access', expires_in: 3599 }); }
    return resp(200, { items: [timed('a')], nextSyncToken: 's' });
  };
  const pool = fakePool([mapping]);
  const out = await g.syncConnection(pool, conn, { ...creds, fetchImpl, now: NOW });
  assert.equal(tokenBody.get('grant_type'), 'refresh_token');
  assert.equal(tokenBody.get('refresh_token'), FAKE_REFRESH);
  assert.equal(out.ok, true);
  assert.equal(out.calendars.length, 1);
  const done = pool.queries.find(q => /SET status = 'connected'/.test(q.sql));
  assert.match(done.sql, /SET status = 'connected', last_error = \$2, last_synced_at = now\(\)/);
  assert.deepEqual(done.params, [conn.id, null]);
  // A successful sync resolves the reconnect alert
  const resolve = pool.queries.at(-1);
  assert.match(resolve.sql, /^UPDATE alerts SET resolved_at = now\(\)/);
  assert.deepEqual(resolve.params, ['calendar-reconnect:avihu']);
  // The events take the connection's user as owner
  const ins = pool.client.queries.find(q => q.sql.startsWith('INSERT INTO events'));
  assert.equal(ins.params[3], 'avihu');
});

test('syncConnection: invalid_grant → status error with a safe code, reconnect alert, activity log, no calendar touched', async () => {
  const fetchImpl = async () => resp(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
  const pool = fakePool([mapping]);
  const out = await g.syncConnection(pool, conn, { ...creds, fetchImpl, now: NOW });
  assert.deepEqual(out, { ok: false, error: 'invalid_grant', calendars: [] });
  assert.equal(pool.queries.length, 3);
  const alert = pool.queries[1];
  assert.match(alert.sql, /^INSERT INTO alerts .* VALUES \(\$1, 'calendar-reconnect', 'orange', 'warning', 'יומן Google: צריך לחבר מחדש', 'הגדרות ← יומן Google ← חבר מחדש', \$2\) ON CONFLICT \(alert_key\) WHERE resolved_at IS NULL DO UPDATE SET last_seen = now\(\)$/);
  assert.deepEqual(alert.params, ['calendar-reconnect:avihu', 'avihu']);
  const logged = pool.queries[2];
  assert.match(logged.sql, /^INSERT INTO activity_log .* VALUES \(\$1, 'calendar', \$2, \$3, \$4\)$/);
  assert.deepEqual(logged.params, ['avihu', conn.id, 'auth_failed', JSON.stringify({ error: 'invalid_grant' })]);
  assert.ok(!JSON.stringify(pool.queries).includes(FAKE_REFRESH));
  assert.match(pool.queries[0].sql, /UPDATE calendar_connections SET status = CASE WHEN \$3 THEN 'error'/);
  assert.deepEqual(pool.queries[0].params, [conn.id, 'invalid_grant', true]);
  assert.equal(pool.client.queries.length, 0);
});

test('listCalendars: follows pages', async () => {
  const fetchImpl = async url => new URL(url).searchParams.get('pageToken')
    ? resp(200, { items: [{ id: 'team@group.example', summary: 'צוות', accessRole: 'reader', backgroundColor: '#0f0' }] })
    : resp(200, { items: [{ id: 'me@example.com', summary: 'me', primary: true, accessRole: 'owner' }], nextPageToken: 'n' });
  const cals = await g.listCalendars('fake-access', { fetchImpl });
  assert.deepEqual(cals.map(c => [c.id, c.primary, c.access_role]), [['me@example.com', true, 'owner'], ['team@group.example', false, 'reader']]);
});

// ---------- stage 2.2: scopes, writes, push channels ----------

test('parseScopes: read/write from the granted scope string', () => {
  const both = g.parseScopes('https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly');
  assert.deepEqual([both.read, both.write, both.listCalendars], [true, true, true]);
  const old = g.parseScopes('https://www.googleapis.com/auth/calendar.readonly');
  assert.deepEqual([old.read, old.write], [true, false]);
  const none = g.parseScopes(null);
  assert.deepEqual([none.read, none.write, none.list], [false, false, []]);
  assert.equal(g.parseScopes('openid https://www.googleapis.com/auth/calendar').write, true);
  assert.equal(g.parseScopes('https://www.googleapis.com/auth/calendar.events.readonly').write, false);
});

test('localTimeUtc: Israel wall time → UTC, summer and winter', () => {
  assert.equal(g.localTimeUtc('2026-07-15', '10:00'), '2026-07-15T07:00:00.000Z');
  assert.equal(g.localTimeUtc('2026-12-01', '10:00'), '2026-12-01T08:00:00.000Z');
  assert.throws(() => g.localTimeUtc('2026-12-01', '25:00'), /Bad/);
});

test('toGoogleBody: timed in Asia/Jerusalem; all-day uses Israel dates with exclusive end', () => {
  const timed = g.toGoogleBody({ title: 'פגישה', start_at: '2026-10-08T07:00:00.000Z', end_at: '2026-10-08T08:00:00.000Z', all_day: false, description: 'x' });
  assert.deepEqual(timed, {
    summary: 'פגישה', description: 'x',
    start: { dateTime: '2026-10-08T07:00:00.000Z', timeZone: 'Asia/Jerusalem' }, end: { dateTime: '2026-10-08T08:00:00.000Z', timeZone: 'Asia/Jerusalem' },
  });
  const allDay = g.toGoogleBody({ title: 'חופש', start_at: g.localMidnightUtc('2026-10-08'), end_at: g.localMidnightUtc('2026-10-10'), all_day: true });
  assert.deepEqual(allDay, { summary: 'חופש', start: { date: '2026-10-08' }, end: { date: '2026-10-10' } });
});

const EV_FIELDS = { title: 'פגישה', start_at: '2026-10-08T07:00:00.000Z', end_at: '2026-10-08T08:00:00.000Z', all_day: false, description: null };
const gEvent = (extra = {}) => ({ id: 'ev1', etag: '"e2"', updated: '2026-10-07T12:00:00.000Z', status: 'confirmed', summary: 'פגישה',
  start: { dateTime: '2026-10-08T07:00:00Z' }, end: { dateTime: '2026-10-08T08:00:00Z' }, htmlLink: 'https://calendar.google.com/e', ...extra });

test('insertEvent: POST to the calendar with a JSON body and bearer token', async () => {
  let call;
  const fetchImpl = async (url, init) => { call = { url: String(url), init }; return resp(200, gEvent()); };
  const ev = await g.insertEvent({ accessToken: 'fake-access', calendarId: 'team@group.example', fields: EV_FIELDS, fetchImpl });
  assert.equal(call.url, 'https://www.googleapis.com/calendar/v3/calendars/team%40group.example/events');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer fake-access');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(call.init.body);
  assert.equal(body.summary, 'פגישה');
  assert.equal(body.description, '');
  assert.deepEqual(body.start, { dateTime: '2026-10-08T07:00:00.000Z', timeZone: 'Asia/Jerusalem' });
  const row = g.toEventRow(ev);
  assert.deepEqual([row.google_event_id, row.google_etag, row.google_updated_at], ['ev1', '"e2"', '2026-10-07T12:00:00.000Z']);
});

test('patchEvent: PATCH with If-Match: <etag>; 412 → GoogleError conflict', async () => {
  const calls = [];
  let status = 200;
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return status === 200 ? resp(200, gEvent()) : resp(412, { error: { errors: [{ reason: 'conditionNotMet' }] } }); };
  await g.patchEvent({ accessToken: 'fake-access', calendarId: 'me@example.com', eventId: 'ev/1', fields: EV_FIELDS, etag: '"e1"', fetchImpl });
  assert.equal(calls[0].url, 'https://www.googleapis.com/calendar/v3/calendars/me%40example.com/events/ev%2F1');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(calls[0].init.headers['If-Match'], '"e1"');
  assert.equal(JSON.parse(calls[0].init.body).summary, 'פגישה');
  status = 412;
  await assert.rejects(g.patchEvent({ accessToken: 'fake-access', calendarId: 'me@example.com', eventId: 'ev1', fields: EV_FIELDS, etag: '"old"', fetchImpl }),
    e => e instanceof g.GoogleError && e.code === 'conflict' && e.status === 412);
  // No etag → no If-Match (last write wins)
  status = 200;
  await g.patchEvent({ accessToken: 'fake-access', calendarId: 'me@example.com', eventId: 'ev1', fields: EV_FIELDS, etag: null, fetchImpl });
  assert.equal(calls.at(-1).init.headers['If-Match'], undefined);
});

test('removeEvent: DELETE; already gone (404/410) counts as done; other errors throw', async () => {
  let call, status = 204;
  const fetchImpl = async (url, init) => { call = { url: String(url), init }; return resp(status, null); };
  assert.equal(await g.removeEvent({ accessToken: 'fake-access', calendarId: 'me@example.com', eventId: 'ev1', fetchImpl }), true);
  assert.equal(call.init.method, 'DELETE');
  assert.equal(call.url, 'https://www.googleapis.com/calendar/v3/calendars/me%40example.com/events/ev1');
  assert.equal(call.init.body, undefined);
  status = 410;
  assert.equal(await g.removeEvent({ accessToken: 'fake-access', calendarId: 'me@example.com', eventId: 'ev1', fetchImpl }), false);
  status = 403;
  await assert.rejects(g.removeEvent({ accessToken: 'fake-access', calendarId: 'me@example.com', eventId: 'ev1', fetchImpl }), e => e.status === 403);
});

test('watchCalendar: events.watch with a random id + secret; only the secret hash comes back', async () => {
  let call;
  const fetchImpl = async (url, init) => { call = { url: String(url), init }; return resp(200, { id: 'x', resourceId: 'res-1', expiration: String(Date.parse('2026-10-14T12:00:00Z')) }); };
  const ch = await g.watchCalendar({ accessToken: 'fake-access', calendarId: 'me@example.com', address: 'https://dash.example/api/google/push', fetchImpl, now: NOW });
  assert.equal(call.url, 'https://www.googleapis.com/calendar/v3/calendars/me%40example.com/events/watch');
  assert.equal(call.init.method, 'POST');
  const body = JSON.parse(call.init.body);
  assert.equal(body.type, 'web_hook');
  assert.equal(body.address, 'https://dash.example/api/google/push');
  assert.equal(body.params.ttl, String(7 * 86400));
  assert.match(body.id, /^[0-9a-f-]{36}$/);
  assert.ok(body.token.length >= 40);
  assert.equal(ch.channel_id, body.id);
  assert.equal(ch.resource_id, 'res-1');
  assert.equal(ch.token_hash, crypto.createHash('sha256').update(body.token).digest('hex'));
  assert.ok(!JSON.stringify(ch).includes(body.token));
  assert.equal(ch.expires_at, '2026-10-14T12:00:00.000Z');
  const again = await g.watchCalendar({ accessToken: 'fake-access', calendarId: 'me@example.com', address: 'https://dash.example/api/google/push', fetchImpl, now: NOW });
  assert.notEqual(again.channel_id, ch.channel_id);
  assert.notEqual(again.token_hash, ch.token_hash);
});

test('stopChannel: channels.stop with id + resourceId; unknown channel (404) is fine', async () => {
  let call, status = 204;
  const fetchImpl = async (url, init) => { call = { url: String(url), init }; return resp(status, null); };
  assert.equal(await g.stopChannel({ accessToken: 'fake-access', channelId: 'ch-1', resourceId: 'res-1', fetchImpl }), true);
  assert.equal(call.url, 'https://www.googleapis.com/calendar/v3/channels/stop');
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(JSON.parse(call.init.body), { id: 'ch-1', resourceId: 'res-1' });
  status = 404;
  assert.equal(await g.stopChannel({ accessToken: 'fake-access', channelId: 'ch-1', resourceId: 'res-1', fetchImpl }), false);
});

test('verifyChannelToken: sha256 match only', () => {
  const secret = crypto.randomBytes(32).toString('base64url');
  const hash = g.hashChannelToken(secret);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(g.verifyChannelToken(secret, hash), true);
  assert.equal(g.verifyChannelToken(secret + 'x', hash), false);
  assert.equal(g.verifyChannelToken('', hash), false);
  assert.equal(g.verifyChannelToken(null, hash), false);
  assert.equal(g.verifyChannelToken(secret, null), false);
  assert.equal(g.verifyChannelToken(secret, 'abc'), false);
  assert.equal(g.verifyChannelToken(hash, hash), false);   // the stored hash itself is not the secret
});

test('pushAddress: APP_URL, else the Vercel production URL; https only', () => {
  assert.equal(g.pushAddress({ APP_URL: 'https://dash.example' }), 'https://dash.example/api/google/push');
  assert.equal(g.pushAddress({ APP_URL: 'https://dash.example/', VERCEL_PROJECT_PRODUCTION_URL: 'other.vercel.app' }), 'https://dash.example/api/google/push');
  assert.equal(g.pushAddress({ VERCEL_PROJECT_PRODUCTION_URL: 'gd.vercel.app' }), 'https://gd.vercel.app/api/google/push');
  assert.equal(g.pushAddress({ APP_URL: 'http://localhost:3000' }), null);
  assert.equal(g.pushAddress({}), null);
  assert.equal(g.pushAddress({ APP_URL: 'not a url' }), null);
});

test('syncConnection: 401 on refresh → error + alert; a push sync limits to one mapping', async () => {
  const pool = fakePool([mapping]);
  const out = await g.syncConnection(pool, conn, { ...creds, fetchImpl: async () => resp(401, {}), now: NOW });
  assert.equal(out.error, 'http_401');
  assert.deepEqual(pool.queries[0].params, [conn.id, 'http_401', true]);
  assert.match(pool.queries[1].sql, /^INSERT INTO alerts/);

  const pool2 = fakePool([{ ...mapping, scope: 'shared' }]);
  const fetchImpl = async (url) => String(url).startsWith('https://oauth2') ? resp(200, { access_token: 'fake-access' }) : resp(200, { items: [timed('a')], nextSyncToken: 's' });
  await g.syncConnection(pool2, conn, { ...creds, fetchImpl, now: NOW, onlyMappingId: mapping.id });
  const sel = pool2.queries.find(q => /FROM calendar_mappings/.test(q.sql));
  assert.deepEqual(sel.params, [conn.id, mapping.id]);
  const ins = pool2.client.queries.find(q => q.sql.startsWith('INSERT INTO events'));
  assert.equal(ins.params[7], 'shared');   // events inherit the mapping's scope
});

test('syncCalendar: needs the owner (no hardcoded user)', async () => {
  await assert.rejects(g.syncCalendar(fakeClient(), mapping, 'fake-access', { fetchImpl: async () => resp(200, { items: [] }), now: NOW }), /ownerUserId/);
});
