import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, X } from 'lucide-react';
import { signedReceiptUrl } from '../data/store';

/** The stored copy of a receipt (photo or PDF). Tap to open it full screen. */
export function ReceiptThumb({ path, size = 40, wide = false }: { path: string; size?: number; wide?: boolean }) {
  const [url, setUrl] = useState('');
  const [open, setOpen] = useState(false);
  const pdf = /\.pdf$/i.test(path);
  useEffect(() => { let live = true; signedReceiptUrl(path).then((u) => live && setUrl(u)); return () => { live = false; }; }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey);
  }, [open]);

  const show = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!url) return;
    if (pdf) window.open(url, '_blank', 'noopener'); else setOpen(true);
  };
  return (
    <>
      <button type="button" className={`receipt-thumb${wide ? ' wide' : ''}`} style={wide ? undefined : { width: size, height: size }} onClick={show} aria-label="הצגת הקבלה">
        {pdf ? <><FileText size={wide ? 22 : 18} />{wide && <span>קבלה (PDF)</span>}</> : url ? <img src={url} alt="קבלה" loading="lazy" /> : <span className="receipt-thumb-ph" />}
      </button>
      {open && createPortal(
        <div className="receipt-viewer" role="dialog" aria-label="קבלה" onClick={() => setOpen(false)}>
          <button className="icon-btn" aria-label="סגירה" onClick={() => setOpen(false)}><X size={20} /></button>
          <img src={url} alt="קבלה" onClick={(e) => e.stopPropagation()} />
        </div>, document.body)}
    </>
  );
}
