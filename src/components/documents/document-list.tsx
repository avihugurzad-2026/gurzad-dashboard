import Link from 'next/link';
import { Download, FileText, History } from 'lucide-react';
import type { DocumentItem } from '@/server/documents';
import { Badge, type Tone } from '@/components/ui/badge';
import { docTypeLabel, fileSize } from '@/lib/documents';
import { shortDate, stamp } from '@/lib/format';
import { NewVersionDialog, RemoveDocumentButton } from './document-forms';

const TONE: Record<string, Tone> = { invoice: 'accent', receipt: 'good', contract: 'warning', legal: 'critical', report: 'neutral', other: 'neutral' };

// One row per document: type, name, where it belongs, date, versions; download the latest, upload a
// new version, see the history, soft delete. A list (not a table) so it wraps on a phone.
export function DocumentList({ items, path, showPlace = true }: { items: DocumentItem[]; path: string; showPlace?: boolean }) {
  return (
    <ul className="flex flex-col divide-y divide-[color:var(--border)]">
      {items.map(d => {
        const latest = d.versions[0] ?? null;
        return (
          <li key={d.id} id={`doc-${d.id}`} className="flex flex-col gap-1.5 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge tone={TONE[d.doc_type]}>{docTypeLabel(d.doc_type)}</Badge>
              <span className="min-w-0 flex-1 break-words font-medium text-ink"><bdi>{d.title}</bdi></span>
              {d.scope === 'user' && <Badge>פרטי</Badge>}
              <span className="flex items-center gap-1">
                {latest && (
                  <a href={`/api/v1/files/${latest.file_id}`} download className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium text-accent hover:bg-surface-2"
                    aria-label={`הורדת ${d.title} (גרסה ${latest.version})`}>
                    <Download className="size-3.5" aria-hidden />הורדה
                  </a>
                )}
                {d.can_edit && <NewVersionDialog id={d.id} title={d.title} path={path} />}
                {d.can_delete && <RemoveDocumentButton id={d.id} title={d.title} path={path} />}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {showPlace && <Link href={d.place_href} className="hover:text-ink hover:underline"><bdi dir="rtl">{d.context}</bdi></Link>}
              <span>{d.doc_date ? shortDate(d.doc_date) : <>הועלה {stamp(d.created_at)}</>}</span>
              {latest && <span><bdi>{latest.name}</bdi> · <span dir="ltr">{fileSize(latest.size)}</span></span>}
              {d.owner_name && <span>{d.owner_name}</span>}
            </div>
            {d.notes && <p className="text-sm text-ink-2"><bdi>{d.notes}</bdi></p>}
            <details className="group text-xs">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-muted hover:text-ink">
                <History className="size-3.5" aria-hidden />
                {d.versions.length === 1 ? 'גרסה אחת' : `${d.versions.length} גרסאות`} · היסטוריה
              </summary>
              <ol className="mt-2 flex flex-col gap-1 border-s-2 border-line ps-3">
                {d.versions.map(v => (
                  <li key={v.version} className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium text-ink">גרסה {v.version}</span>
                    {v.version === d.current_version && <Badge tone="accent">נוכחית</Badge>}
                    <a href={`/api/v1/files/${v.file_id}`} download className="text-accent hover:underline"><bdi>{v.name}</bdi></a>
                    <span className="text-muted">{stamp(v.created_at)}{v.by ? ` · ${v.by}` : ''}</span>
                    {v.note && <span className="text-ink-2">— <bdi>{v.note}</bdi></span>}
                  </li>
                ))}
              </ol>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

export function NoDocuments({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
      <FileText className="size-5" aria-hidden />
      <p className="font-medium text-ink">אין נתונים עדיין</p>
      {children}
    </div>
  );
}
