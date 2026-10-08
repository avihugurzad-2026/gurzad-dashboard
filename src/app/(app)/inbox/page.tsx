import { Inbox as InboxIcon } from 'lucide-react';
import { inbox } from '@/server/entries';
import { InboxCapture } from '@/components/inbox/capture';
import { ClassifiedRow, InboxRow } from '@/components/inbox/inbox-row';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shell/page-header';

export const metadata = { title: 'Inbox — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

// Everything not sorted yet. Nothing here is lost: it stays until it is filed or deleted.
export default async function InboxPage() {
  const { open, recent } = await inbox();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Inbox" subtitle="כל מה שעוד לא שויך: משימה מהירה, רעיון, הערה או קובץ" />
      <Card><CardContent className="pt-5 sm:pt-6"><InboxCapture /></CardContent></Card>
      <Card>
        <CardHeader><CardTitle>לא משויך</CardTitle><Badge className="tabular">{open.length}</Badge></CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <Empty icon={<InboxIcon aria-hidden />} title="ה-Inbox ריק">כל מה שתכניס למעלה, או תשלח מ"+ חדש", יחכה כאן עד שתשייך אותו.</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">{open.map(i => <InboxRow key={i.id} item={i} />)}</ul>
          )}
        </CardContent>
      </Card>
      {recent.length > 0 && (
        <Card>
          <CardHeader><CardTitle>שויכו לאחרונה</CardTitle><span className="text-sm text-muted">14 ימים</span></CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">{recent.map(i => <ClassifiedRow key={i.id} item={i} />)}</ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
