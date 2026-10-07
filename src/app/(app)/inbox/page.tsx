import { Inbox as InboxIcon } from 'lucide-react';
import { inbox } from '@/server/entries';
import { InboxCapture } from '@/components/inbox/capture';
import { ClassifiedRow, InboxRow } from '@/components/inbox/inbox-row';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';

export const metadata = { title: 'Inbox — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

// Everything not sorted yet. Nothing here is lost: it stays until it is filed or deleted.
export default async function InboxPage() {
  const { open, recent } = await inbox();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold"><bdi>Inbox</bdi></h1>
        <p className="text-sm text-muted">כל מה שעוד לא שויך: משימה מהירה, רעיון, הערה או קובץ</p>
      </div>
      <Card><CardContent className="pt-4"><InboxCapture /></CardContent></Card>
      <Card>
        <CardHeader><CardTitle>לא משויך</CardTitle><span className="text-sm text-muted">{open.length}</span></CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <Empty icon={<InboxIcon className="size-6" />} title="ה-Inbox ריק">כל מה שתכניס למעלה, או תשלח מ"+ חדש", יחכה כאן עד שתשייך אותו.</Empty>
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
