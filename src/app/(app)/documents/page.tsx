import Link from 'next/link';
import { FileSearch, Search } from 'lucide-react';
import { canSeePlace, requireUser } from '@/server/auth';
import { documentPlaces, listDocuments } from '@/server/documents';
import { Card, CardContent } from '@/components/ui/card';
import { Button, buttonClass } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { DateField } from '@/components/ui/date-field';
import { PageHeader } from '@/components/shell/page-header';
import { NotReady } from '@/components/work/not-ready';
import { inputClass, labelClass, selectClass } from '@/components/work/fields';
import { cn } from '@/lib/utils';
import { DocumentList, NoDocuments } from '@/components/documents/document-list';
import { UploadDocumentDialog } from '@/components/documents/document-forms';
import { DOC_TYPES, isDocType } from '@/lib/documents';
import { decodePlace, encodePlace, placeOptions } from '@/lib/places';

export const metadata = { title: 'מסמכים — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: string | undefined) => (v && DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

// Documents (3.4): one list for every area, entity and branch, filtered to what this user may see.
// Search by name (title or file name), type, place and date.
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100) || null;
  const type = isDocType(sp.type) ? sp.type : null;
  const place = sp.place ? decodePlace(sp.place) : null;
  const from = date(sp.from), to = date(sp.to);
  const limit = Math.min(Math.max(Number(sp.n) || 100, 100), 300);
  const { ready, items, more } = await listDocuments(u, { q, type, place, from, to, limit });
  const seeable = placeOptions().filter(o => canSeePlace(u, o.place, 'money'));
  const uploadPlaces = documentPlaces(u);
  const filtered = Boolean(q || type || place || from || to);
  const qs = new URLSearchParams(Object.entries({ q, type, place: place ? encodePlace(place) : null, from, to }).filter(([, v]) => v) as [string, string][]);
  const moreHref = `/documents?${new URLSearchParams([...qs, ['n', String(limit + 100)]])}`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="מסמכים" subtitle="חשבוניות, קבלות, חוזים ודוחות מכל האזורים, במקום אחד"
        actions={ready ? <UploadDocumentDialog places={uploadPlaces} defaultPlace={place ? encodePlace(place) : null} path="/documents" /> : undefined} />
      <Card><CardContent className="pt-5 sm:pt-6">
      <form action="/documents" role="search" aria-label="סינון מסמכים" className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-6">
        <label className={cn(labelClass, 'col-span-2 flex flex-col gap-1.5')}>חיפוש
          <input name="q" defaultValue={q ?? ''} placeholder="שם מסמך או קובץ" className={inputClass} />
        </label>
        <label className={cn(labelClass, 'flex flex-col gap-1.5')}>סוג
          <select name="type" defaultValue={type ?? ''} className={selectClass}>
            <option value="">הכול</option>
            {DOC_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className={cn(labelClass, 'flex flex-col gap-1.5')}>שייך ל
          <select name="place" defaultValue={place ? encodePlace(place) : ''} className={selectClass}>
            <option value="">הכול</option>
            {seeable.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="doc-from" className={labelClass}>מתאריך</label>
          <DateField id="doc-from" name="from" defaultValue={from ?? ''} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="doc-to" className={labelClass}>עד תאריך</label>
          <DateField id="doc-to" name="to" defaultValue={to ?? ''} />
        </div>
        <div className="col-span-2 flex items-center gap-2 sm:col-span-6">
          <Button type="submit" variant="secondary"><Search aria-hidden />סנן</Button>
          {filtered && <Link href="/documents" className={buttonClass('ghost', 'md')}>נקה סינון</Link>}
        </div>
      </form>
      </CardContent></Card>
      <Card>
        <CardContent className="pt-5 sm:pt-6">
          {!ready ? <NotReady what="מסמכים" />
            : items.length === 0 ? (
              filtered ? <Empty compact icon={<FileSearch aria-hidden />} title="לא נמצאו מסמכים">אין מסמכים שמתאימים לסינון הזה.</Empty>
                : <NoDocuments>{uploadPlaces.length ? 'העלה חשבונית, קבלה, חוזה או דוח, ושייך אותו לאזור, לישות ולסניף.' : null}</NoDocuments>
            ) : (
              <>
                <p className="text-sm text-muted tabular">{items.length} מסמכים{more ? '+' : ''}</p>
                <DocumentList items={items} path="/documents" />
                {more && <Link href={moreHref} className={buttonClass('secondary', 'sm', 'mt-3')}>עוד מסמכים</Link>}
              </>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
