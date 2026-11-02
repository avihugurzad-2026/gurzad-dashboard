import Link from 'next/link';
import { Download, FileText, History } from 'lucide-react';
import type { DocumentItem } from '@/server/documents';
import { Badge, type Tone } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
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
          <li key={d.id} id={`doc-${d.id}`} className="flex flex-col gap-2 py-4">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <Badge tone={TONE[d.doc_type]}>{docTypeLabel(d.doc_type)}</Badge>
              <span className="min-w-0 flex-1 break-words text-body font-medium text-ink"><bdi>{d.title}</bdi></span>
              {d.scope === 'user' && <Badge>פרטי</Badge>}
              <span className="flex items-center gap-1">
                {latest && (
                  <a href={`/api/v1/files/${latest.file_id}`} download className={buttonClass('ghost', 'sm', 'px-2 text-accent-ink')}
                    aria-label={`הורדת ${d.title} (גרסה ${latest.version})`}>
                    <Download aria-hidden />הורדה
                  </a>
                )}
                {d.can_edit && <NewVersionDialog id={d.id} title={d.title} path={path} />}
                {d.can_delete && <RemoveDocumentButton id={d.id} title={d.title} path={path} />}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
              {showPlace && <Link href={d.place_href} className="rounded-full hover:opacity-80"><Badge tone="accent"><bdi dir="rtl">{d.context}</bdi></Badge></Link>}
              <span className="tabular">{d.doc_date ? shortDate(d.doc_date) : <>הועלה {stamp(d.created_at)}</>}</span>
              {latest && <span><bdi>{latest.name}</bdi> · <span dir="ltr">{fileSize(latest.size)}</span></span>}
              {d.owner_name && <span><bdi>{d.owner_name}</bdi></span>}
            </div>
            {d.notes && <p className="text-sm text-ink-2"><bdi>{d.notes}</bdi></p>}
            <details className="group text-sm">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted hover:text-ink">
                <History className="size-4" aria-hidden />
                {d.versions.length === 1 ? 'גרסה אחת' : `${d.versions.length} גרסאות`} · היסטוריה
              </summary>
              <ol className="mt-3 flex flex-col gap-2 border-s-2 border-line ps-3 text-xs">
                {d.versions.map(v => (
                  <li key={v.version} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-ink">גרסה {v.version}</span>
                    {v.version === d.current_version && <Badge tone="accent">נוכחית</Badge>}
                    <a href={`/api/v1/files/${v.file_id}`} download className="text-accent-ink hover:underline"><bdi>{v.name}</bdi></a>
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
    <Empty compact icon={<FileText aria-hidden />} title="אין נתונים עדיין">{children}</Empty>
  );
}
