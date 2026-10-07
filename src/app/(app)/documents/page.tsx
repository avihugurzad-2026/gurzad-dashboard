import Link from 'next/link';
import { Search } from 'lucide-react';
import { canSeePlace, requireUser } from '@/server/auth';
import { documentPlaces, listDocuments } from '@/server/documents';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { NotReady } from '@/components/work/not-ready';
import { inputClass } from '@/components/work/fields';
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
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page font-bold">מסמכים</h1>
        {ready && <UploadDocumentDialog places={uploadPlaces} defaultPlace={place ? encodePlace(place) : null} path="/documents" />}
      </div>
      <form action="/documents" role="search" aria-label="סינון מסמכים" className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">חיפוש
          <input name="q" defaultValue={q ?? ''} placeholder="שם מסמך או קובץ" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">סוג
          <select name="type" defaultValue={type ?? ''} className={inputClass}>
            <option value="">הכול</option>
            {DOC_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">שייך ל
          <select name="place" defaultValue={place ? encodePlace(place) : ''} className={inputClass}>
            <option value="">הכול</option>
            {seeable.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">מתאריך
          <input type="date" name="from" defaultValue={from ?? ''} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">עד תאריך
          <input type="date" name="to" defaultValue={to ?? ''} className={inputClass} />
        </label>
        <div className="col-span-2 flex items-center gap-3 sm:col-span-6">
          <Button type="submit" variant="primary" size="sm"><Search className="size-4" aria-hidden />סנן</Button>
          {filtered && <Link href="/documents" className="text-sm text-muted hover:text-ink">נקה סינון</Link>}
        </div>
      </form>
      <Card>
        <CardContent className="pt-2">
          {!ready ? <div className="pt-3"><NotReady what="מסמכים" /></div>
            : items.length === 0 ? (
              <div className="pt-3">
                {filtered ? <p className="py-4 text-center text-sm text-muted">לא נמצאו מסמכים לסינון הזה.</p>
                  : <NoDocuments>{uploadPlaces.length ? 'העלה חשבונית, קבלה, חוזה או דוח, ושייך אותו לאזור, לישות ולסניף.' : null}</NoDocuments>}
              </div>
            ) : (
              <>
                <p className="pt-2 text-xs text-muted">{items.length} מסמכים{more ? '+' : ''}</p>
                <DocumentList items={items} path="/documents" />
                {more && <Link href={moreHref} className="mt-2 inline-block text-sm font-medium text-accent hover:underline">עוד</Link>}
              </>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
