declare namespace gcal {
  type Calendar = { id: string; name: string | null; color: string | null; access_role: string | null; primary: boolean };
  type EventRow = {
    google_event_id: string; title: string; start_at: string | null; end_at: string | null; all_day: boolean;
    timezone: string; place: string | null; status: 'confirmed' | 'tentative' | 'cancelled'; html_link: string | null;
  };
  type Mapping = { id: string; google_calendar_id: string; domain?: string | null; branch?: string | null; location?: string | null; sync_token?: string | null };
  type Connection = { id: string; user_id: string; refresh_token_encrypted: string };
  type CalendarCounts = { calendar: string; full: boolean; fetched: number; upserted: number; removed: number };
  type SyncResult = { ok: boolean; error?: string; calendars: CalendarCounts[] };
  type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;
  interface GoogleError extends Error { code: string; status?: number }
}
declare const gcal: {
  SCOPE: string;
  GoogleError: new (code: string, status?: number) => gcal.GoogleError;
  encryptToken(plain: string, keyB64: string | undefined): string;
  decryptToken(stored: string, keyB64: string | undefined): string;
  authUrl(opts: { clientId: string; redirectUri: string; state: string }): string;
  exchangeCode(opts: { code: string; clientId: string; clientSecret: string; redirectUri: string; fetchImpl?: gcal.FetchImpl }): Promise<{ access_token: string; refresh_token: string | null; expires_in: number | null; scope: string | null }>;
  refreshAccessToken(opts: { refreshToken: string; clientId: string; clientSecret: string; fetchImpl?: gcal.FetchImpl }): Promise<{ access_token: string; expires_in: number | null }>;
  revokeToken(token: string, opts?: { fetchImpl?: gcal.FetchImpl }): Promise<boolean>;
  listCalendars(accessToken: string, opts?: { fetchImpl?: gcal.FetchImpl }): Promise<gcal.Calendar[]>;
  localMidnightUtc(date: string, tz?: string): string;
  toEventRow(googleEvent: unknown): gcal.EventRow;
  syncCalendar(client: unknown, mapping: gcal.Mapping, accessToken: string, opts?: { fetchImpl?: gcal.FetchImpl; now?: Date; ownerUserId?: string }): Promise<gcal.CalendarCounts>;
  syncConnection(pool: unknown, connection: gcal.Connection, opts: { clientId: string; clientSecret: string; keyB64: string; fetchImpl?: gcal.FetchImpl; now?: Date }): Promise<gcal.SyncResult>;
};
export = gcal;
