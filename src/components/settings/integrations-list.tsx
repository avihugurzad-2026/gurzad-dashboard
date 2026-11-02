import { PlugZap } from 'lucide-react';
import type { IntegrationStatus } from '@/server/integrations';
import { stamp } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type Tone } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { BuyzSyncButton } from './buyz-sync-button';

const STATUS: Record<IntegrationStatus['status'], { label: string; tone: Tone }> = {
  ok: { label: 'תקין', tone: 'good' },
  error: { label: 'שגיאה', tone: 'critical' },
  disabled: { label: 'מושבת', tone: 'neutral' },
  not_connected: { label: 'לא מחובר', tone: 'warning' },
};
const PROVIDER: Record<string, string> = { buyz: 'Buyz' };

// Settings → "חיבורים" (read-only). Pass the result of integrationsStatus(u); null = not for this user.
// Credential implementation details stay server-side.
export function IntegrationsList({ items }: { items: IntegrationStatus[] | null }) {
  if (items === null) return null;
  return (
    <Card id="integrations">
      <CardHeader>
        <CardTitle>חיבורים</CardTitle>
        <span className="shrink-0 text-sm text-muted">מקורות נתונים לסניפים · סנכרון יומי</span>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <Empty icon={<PlugZap aria-hidden />} title="אין חיבורים">חיבור נוסף נוצר בשורה בטבלת integrations.</Empty>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="data-table min-w-[520px]">
              <caption className="sr-only">חיבורים למקורות נתונים</caption>
              <thead><tr>
                <th scope="col">מקור</th>
                <th scope="col">מקום</th>
                <th scope="col">מצב</th>
                <th scope="col">סנכרון אחרון</th>
                <th scope="col">חיבור</th>
                <th scope="col"><span className="sr-only">פעולות</span></th>
              </tr></thead>
              <tbody>
                {items.map(i => (
                  <tr key={i.id}>
                    <th scope="row" className="font-medium"><bdi>{PROVIDER[i.provider] ?? i.provider}</bdi></th>
                    <td><bdi>{i.place}</bdi></td>
                    <td>
                      <Badge tone={STATUS[i.status]?.tone ?? 'neutral'}>{STATUS[i.status]?.label ?? i.status}</Badge>
                      {i.status === 'error' && i.last_error && <p className="mt-1.5 text-xs text-critical-ink">{i.last_error}</p>}
                    </td>
                    <td className="whitespace-nowrap text-ink-2">{i.last_sync_at ? stamp(i.last_sync_at) : 'עוד לא'}</td>
                    <td className="text-xs text-muted"><bdi dir="ltr">{i.credentials}</bdi></td>
                    <td>{i.provider === 'buyz' && <BuyzSyncButton />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
