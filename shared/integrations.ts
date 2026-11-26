// Catalog of external systems a business can connect to. Shared by the API (validation) and the UI (forms).
// To add a provider: add an entry here and an adapter in api/_lib/integrations/<id>.ts, then register it there.

export type ProviderField = { key: string; label: string; secret?: boolean; placeholder?: string; optional?: boolean; help?: string };
export type ProviderInfo = {
  id: string;
  name: string;
  kind: string;          // shown as category
  description: string;
  fields: ProviderField[];
  provides: string[];    // what data the dashboard pulls
};

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'buyz',
    name: 'Buyz',
    kind: 'תורים, קופה והכנסות',
    description: 'מערכת הניהול של העסק. המפתח נמצא בפורטל Buyz ← אינטגרציות ← BUYZ API.',
    fields: [
      { key: 'api_key', label: 'מפתח API', secret: true, placeholder: 'rk_…' },
      { key: 'base_url', label: 'כתובת השרת', optional: true, placeholder: 'https://buyz.co.il', help: 'להשאיר ריק אם לא שונה' },
    ],
    provides: ['הכנסות לפי חודש ויום', 'אמצעי תשלום', 'מכירות לפי מוכרנית', 'עסקאות אחרונות'],
  },
  {
    id: 'morning',
    name: 'מורנינג (חשבונית ירוקה)',
    kind: 'חשבוניות',
    description: 'המפתח נוצר במורנינג ← הגדרות ← כלים למפתחים ← מפתחות API. מספיקה הרשאת קריאה.',
    fields: [
      { key: 'api_id', label: 'API Key ID', secret: true, placeholder: 'xxxxxxxx-xxxx-…' },
      { key: 'api_secret', label: 'API Secret', secret: true },
    ],
    provides: ['הכנסות לפי חודש (לפני מע״מ, בניכוי זיכויים)', 'חשבוניות פתוחות', 'הכנסות לפי לקוח', 'מסמכים אחרונים'],
  },
];

export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id);

/** Normalized revenue snapshot (what the UI renders). Amounts in ₪ as reported by the provider. */
export type RevenueSnapshot = {
  currency: 'ILS';
  summary: { total: number; count: number; average: number; unpaid: number; bySource: Record<string, number> };
  monthly: { month: string; total: number; count: number }[];
  daily: { date: string; total: number; count: number }[];
  methods: { label: string; total: number; count: number }[];
  sellers: { name: string; total: number; count: number }[];
  sellersTitle?: string;   // what 'sellers' groups by (default: מוכרנית)
  vatIncluded?: boolean;
  transactions: Tx[];
  range: { monthsFrom: string; monthsTo: string };
  /** Today's sales (Buyz). */
  today?: { date: string; total: number; count: number; average: number; methods: { label: string; total: number; count: number }[]; staff: StaffRow[]; transactions: Tx[] };
  /** Sales per employee, from every transaction of the period (Buyz). */
  staff?: { thisMonth: StaffRow[]; lastMonth: StaffRow[]; txCount: number };
};

export type Tx = { id: string; date: string; amount: number; type: string; status: string; customer: string; description: string; seller?: string };
export type StaffRow = { name: string; total: number; count: number; byType: Record<string, number> };

/** Connection as the browser sees it: never includes the secret. */
export type ConnectionView = {
  provider: string;
  status: 'connected' | 'error' | 'disconnected';
  keyHint: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  snapshots: Record<string, { data: unknown; fetchedAt: string }>;
};
