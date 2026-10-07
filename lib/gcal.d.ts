declare namespace gcal {
  type Calendar = { id: string; name: string | null; color: string | null; access_role: string | null; primary: boolean };
  type EventRow = {
    google_event_id: string; title: string; start_at: string | null; end_at: string | null; all_day: boolean;
    timezone: string; place: string | null; status: 'confirmed' | 'tentative' | 'cancelled'; html_link: string | null;
    description: string | null; google_etag: string | null; google_updated_at: string | null;
  };
  type Mapping = { id: string; google_calendar_id: string; domain?: string | null; branch?: string | null; location?: string | null; sync_token?: string | null; scope?: string | null };
  type Connection = { id: string; user_id: string; refresh_token_encrypted: string };
  type CalendarCounts = { calendar: string; full: boolean; fetched: number; upserted: number; removed: number };
  type SyncResult = { ok: boolean; error?: string; calendars: CalendarCounts[] };
  type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;
  type Creds = { clientId: string; clientSecret: string; keyB64: string; fetchImpl?: FetchImpl };
  type Queryable = { query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
  /** Instants (ISO); for all-day, Israel midnights with an exclusive end — same as events rows */
  type EventFields = { title: string; start_at: string; end_at: string; all_day: boolean; description?: string | null; place?: string | null };
  type GoogleEvent = Record<string, unknown> & { id?: string; etag?: string };
  type Channel = { channel_id: string; resource_id: string | null; token_hash: string; expires_at: string };
  interface GoogleError extends Error { code: string; status?: number }
}
declare const gcal: {
  SCOPE: string;
  SCOPES: string[];
  SCOPE_EVENTS: string;
  SCOPE_READONLY: string;
  TZ: string;
  GoogleError: new (code: string, status?: number) => gcal.GoogleError;
  encryptToken(plain: string, keyB64: string | undefined): string;
  decryptToken(stored: string, keyB64: string | undefined): string;
  authUrl(opts: { clientId: string; redirectUri: string; state: string }): string;
  exchangeCode(opts: { code: string; clientId: string; clientSecret: string; redirectUri: string; fetchImpl?: gcal.FetchImpl }): Promise<{ access_token: string; refresh_token: string | null; expires_in: number | null; scope: string | null }>;
  refreshAccessToken(opts: { refreshToken: string; clientId: string; clientSecret: string; fetchImpl?: gcal.FetchImpl }): Promise<{ access_token: string; expires_in: number | null }>;
  revokeToken(token: string, opts?: { fetchImpl?: gcal.FetchImpl }): Promise<boolean>;
  listCalendars(accessToken: string, opts?: { fetchImpl?: gcal.FetchImpl }): Promise<gcal.Calendar[]>;
  parseScopes(scope: string | null | undefined): { list: string[]; read: boolean; write: boolean; listCalendars: boolean };
  localMidnightUtc(date: string, tz?: string): string;
  localTimeUtc(date: string, hm: string, tz?: string): string;
  localDate(instant: string | Date, tz?: string): string;
  toEventRow(googleEvent: unknown): gcal.EventRow;
  toGoogleBody(fields: gcal.EventFields): Record<string, unknown>;
  syncCalendar(client: unknown, mapping: gcal.Mapping, accessToken: string, opts: { fetchImpl?: gcal.FetchImpl; now?: Date; ownerUserId: string }): Promise<gcal.CalendarCounts>;
  syncConnection(pool: unknown, connection: gcal.Connection, opts: gcal.Creds & { now?: Date; onlyMappingId?: string | null }): Promise<gcal.SyncResult>;
  accessTokenFor(pool: unknown, connection: gcal.Connection, opts: gcal.Creds): Promise<{ ok: true; accessToken: string } | { ok: false; error: string }>;
  insertEvent(opts: { accessToken: string; calendarId: string; fields: gcal.EventFields; fetchImpl?: gcal.FetchImpl }): Promise<gcal.GoogleEvent>;
  getEvent(opts: { accessToken: string; calendarId: string; eventId: string; fetchImpl?: gcal.FetchImpl }): Promise<gcal.GoogleEvent>;
  patchEvent(opts: { accessToken: string; calendarId: string; eventId: string; fields: gcal.EventFields; etag?: string | null; fetchImpl?: gcal.FetchImpl }): Promise<gcal.GoogleEvent>;
  removeEvent(opts: { accessToken: string; calendarId: string; eventId: string; fetchImpl?: gcal.FetchImpl }): Promise<boolean>;
  hashChannelToken(token: string): string;
  verifyChannelToken(token: string | null | undefined, storedHash: string | null | undefined): boolean;
  pushAddress(env?: Record<string, string | undefined>): string | null;
  watchCalendar(opts: { accessToken: string; calendarId: string; address: string; ttlSeconds?: number; fetchImpl?: gcal.FetchImpl; now?: Date }): Promise<gcal.Channel>;
  stopChannel(opts: { accessToken: string; channelId: string; resourceId: string | null; fetchImpl?: gcal.FetchImpl }): Promise<boolean>;
  logActivity(db: unknown, entry: { userId: string | null; objectId: string; action: string; metadata?: Record<string, unknown> }): Promise<void>;
  raiseReconnectAlert(db: unknown, userId: string): Promise<void>;
  resolveReconnectAlert(db: unknown, userId: string): Promise<void>;
};
export = gcal;
