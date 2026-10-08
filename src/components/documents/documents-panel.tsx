import Link from 'next/link';
import { requireUser } from '@/server/auth';
import { documentPlaces, listDocuments } from '@/server/documents';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NotReady } from '@/components/work/not-ready';
import { buttonClass } from '@/components/ui/button';
import { encodePlace, hrefFor, type Place } from '@/lib/places';
import { DocumentList, NoDocuments } from './document-list';
import { UploadDocumentDialog } from './document-forms';

// "Documents of this object" for entity, branch and ventures pages.
//   <DocumentsPanel place={{ domain: 'business', branch: 'adigital' }} path="/business/adigital" />
//   <DocumentsPanel subject={{ type: 'asset', id }} place={{ domain: 'ventures', branch: 'real-estate' }} path={…} />
// `place` filters to that place and everything inside it, and is where new uploads go by default.
// `subject` (asset / investment / legal_case …) filters to documents linked to that object; new
// uploads are linked to it. Reads are filtered for the signed-in user (visibleSql, kind 'money').
export async function DocumentsPanel({ place, subject, path, title = 'מסמכים', limit = 20 }: {
  place?: Partial<Place> | null; subject?: { type: string; id: string } | null; path?: string; title?: string; limit?: number;
}) {
  const u = await requireUser();
  const { ready, items, more } = await listDocuments(u, { place, subject, limit });
  const here = path ?? (place?.domain ? hrefFor({ domain: place.domain, branch: place.branch ?? null, location: place.location ?? null }) : '/documents');
  const places = documentPlaces(u, place);
  const defaultPlace = place?.domain ? encodePlace({ domain: place.domain, branch: place.branch ?? null, location: place.location ?? null }) : null;
  const all = place?.domain
    ? `/documents?place=${encodeURIComponent(encodePlace({ domain: place.domain, branch: place.branch ?? null, location: place.location ?? null }))}`
    : '/documents';
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <CardTitle>{title}</CardTitle>
        <div className="flex items-center gap-2">
          {!subject && <Link href={all} className={buttonClass('ghost', 'md', 'text-accent-ink')}>כל המסמכים</Link>}
          {ready && <UploadDocumentDialog places={places} defaultPlace={defaultPlace} subject={subject} path={here} />}
        </div>
      </CardHeader>
      <CardContent>
        {!ready ? <NotReady what="מסמכים" />
          : items.length === 0 ? <NoDocuments>{places.length ? 'העלה חוזה, חשבונית או דוח והם יופיעו כאן.' : null}</NoDocuments>
          : (
            <>
              <DocumentList items={items} path={here} showPlace={!place?.location} />
              {more && <Link href={all} className={buttonClass('secondary', 'sm', 'mt-3')}>עוד מסמכים</Link>}
            </>
          )}
      </CardContent>
    </Card>
  );
}
