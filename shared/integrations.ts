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
    id: 'buyzops',
    name: 'Buyz · נתוני תפעול',
    kind: 'הוצאות, עובדות, תורים ולידים',
    description: 'קורא מהקובץ dashboard_ops.php שמותקן בשרת של Buyz. ככה לא צריך לפתוח את המסד לגישה מבחוץ. כל הסניפים ברשת נוספים לבד.',
    fields: [
      { key: 'key', label: 'מפתח הקובץ', secret: true, help: 'המפתח שהוגדר בראש הקובץ (DASHBOARD_KEY)' },
      { key: 'url', label: 'כתובת הקובץ', optional: true, placeholder: 'https://buyz.co.il/api/dashboard_ops.php', help: 'להשאיר ריק אם הקובץ הותקן בכתובת הזו' },
      { key: 'slug', label: 'כינוי העסק ב־Buyz', optional: true, placeholder: 'ospa', help: 'להשאיר ריק עבור OSPA' },
    ],
    provides: ['הוצאות לפי חודש (רווח אמיתי)', 'ביצועי עובדות: מכירות, טיפולים, מוצרים ושעות', 'תורים, ביטולים ואי־הגעות', 'לידים לפי מקור', 'כל הסניפים ברשת'],
  },
  {
    id: 'buyzdb',
    name: 'Buyz · מסד נתונים',
    kind: 'הוצאות, עובדות ותורים',
    description: 'חיבור לקריאה בלבד למסד של Buyz, בשביל נתונים שאין להם API: הוצאות, עובדות ותורים. המשתמש במסד צריך הרשאת גישה מכל כתובת (host %).',
    fields: [
      { key: 'host', label: 'כתובת השרת', placeholder: 'db.example.co.il' },
      { key: 'port', label: 'פורט', optional: true, placeholder: '3306' },
      { key: 'user', label: 'שם משתמש' },
      { key: 'database', label: 'שם המסד' },
      { key: 'password', label: 'סיסמה', secret: true },
      { key: 'slug', label: 'כינוי העסק ב־Buyz', optional: true, placeholder: 'ospa', help: 'להשאיר ריק עבור OSPA' },
    ],
    provides: ['הוצאות לפי חודש (רווח אמיתי)', 'ביצועי עובדות: מכירות, טיפולים, מוצרים ושעות', 'תורים, ביטולים ואי־הגעות', 'לידים לפי מקור'],
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

/** Operational data read from the Buyz database (buyzdb provider). */
export type OpsStaff = { name: string; sold: number; soldCount: number; treatments: number; treatmentsValue: number; products: number; productsCount: number; hours: number };
export type OpsSnapshot = {
  months: string[];
  revenue: Record<string, number>;
  expenses: { byMonth: { month: string; total: number }[]; lines: { label: string; calc: string; amount: number; rate: number }[] };
  staff: { today: OpsStaff[]; thisMonth: OpsStaff[]; lastMonth: OpsStaff[] };
  bookings: { today: number; upcoming: number; done: number; cancelled: number; noShow: number };
  leads: { source: string; count: number }[];
};
