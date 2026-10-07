import { PlugZap } from 'lucide-react';
import type { IntegrationStatus } from '@/server/integrations';
import { stamp } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type Tone } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';

const STATUS: Record<IntegrationStatus['status'], { label: string; tone: Tone }> = {
  ok: { label: 'תקין', tone: 'good' },
  error: { label: 'שגיאה', tone: 'critical' },
  disabled: { label: 'מושבת', tone: 'neutral' },
  not_connected: { label: 'לא מחובר', tone: 'warning' },
};
const PROVIDER: Record<string, string> = { buyz: 'Buyz' };

// Settings → "חיבורים" (read-only). Pass the result of integrationsStatus(u); null = not for this user.
// Shows where each key is read from (an env var name), never the key.
export function IntegrationsList({ items }: { items: IntegrationStatus[] | null }) {
  if (items === null) return null;
  return (
    <Card id="integrations">
      <CardHeader>
        <CardTitle>חיבורים</CardTitle>
        <span className="text-sm text-muted">מקורות נתונים לסניפים · סנכרון יומי</span>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <Empty icon={<PlugZap className="size-6" />} title="אין חיבורים">חיבור נוסף נוצר בשורה בטבלת integrations.</Empty>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <caption className="sr-only">חיבורים למקורות נתונים</caption>
              <thead><tr className="border-b border-line text-xs text-muted">
                <th scope="col" className="py-2 text-start font-medium">מקור</th>
                <th scope="col" className="py-2 text-start font-medium">מקום</th>
                <th scope="col" className="py-2 text-start font-medium">מצב</th>
                <th scope="col" className="py-2 text-start font-medium">סנכרון אחרון</th>
                <th scope="col" className="py-2 text-start font-medium">מפתח</th>
              </tr></thead>
              <tbody>
                {items.map(i => (
                  <tr key={i.id} className="border-b border-line align-top last:border-0">
                    <th scope="row" className="py-2 text-start font-medium"><bdi>{PROVIDER[i.provider] ?? i.provider}</bdi></th>
                    <td className="py-2"><bdi>{i.place}</bdi></td>
                    <td className="py-2">
                      <Badge tone={STATUS[i.status]?.tone ?? 'neutral'}>{STATUS[i.status]?.label ?? i.status}</Badge>
                      {i.status === 'error' && i.last_error && <p className="mt-1 text-xs text-critical-ink">{i.last_error}</p>}
                    </td>
                    <td className="py-2 text-ink-2">{i.last_sync_at ? stamp(i.last_sync_at) : 'עוד לא'}</td>
                    <td className="py-2 text-xs text-muted"><bdi>{i.credentials}</bdi></td>
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
