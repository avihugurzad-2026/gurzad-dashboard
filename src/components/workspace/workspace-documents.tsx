import Link from 'next/link';
import type { SessionUser } from '@/server/auth';
import { documentPlaces, listDocuments } from '@/server/documents';
import { encodePlace, type Place } from '@/lib/places';
import { DocumentList, NoDocuments } from '@/components/documents/document-list';
import { UploadDocumentDialog } from '@/components/documents/document-forms';
import { NotReady } from '@/components/work/not-ready';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonClass } from '@/components/ui/button';

// A workspace's Documents module: the same documents as /documents, scoped to the workspace's place
export async function WorkspaceDocuments({ u, place, path, title = 'מסמכים' }: { u: SessionUser; place: Place; path: string; title?: string }) {
  const { ready, items, more } = await listDocuments(u, { place, limit: 100 });
  const uploadPlaces = documentPlaces(u, place);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {ready && uploadPlaces.length > 0 && <UploadDocumentDialog places={uploadPlaces} defaultPlace={encodePlace(place)} path={path} />}
      </CardHeader>
      <CardContent>
        {!ready ? <NotReady what="מסמכים" />
          : items.length === 0 ? <NoDocuments>{uploadPlaces.length ? 'העלה חוזה, חשבונית או דוח והוא יופיע כאן.' : null}</NoDocuments>
          : (
            <>
              <DocumentList items={items} path={path} showPlace={!place.branch} />
              {more && <Link href={`/documents?place=${encodeURIComponent(encodePlace(place))}`} className={buttonClass('secondary', 'sm', 'mt-3')}>כל המסמכים</Link>}
            </>
          )}
      </CardContent>
    </Card>
  );
}
