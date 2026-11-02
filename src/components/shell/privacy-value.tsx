'use client';

import { useEffect, useState, type ReactNode } from 'react';

function hiddenNow() { return typeof document !== 'undefined' && document.documentElement.dataset.private === '1'; }

export function usePrivacyHidden() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const sync = () => setHidden(hiddenNow());
    sync();
    window.addEventListener('dashboard:privacy', sync);
    return () => window.removeEventListener('dashboard:privacy', sync);
  }, []);
  return hidden;
}

// Do not rely on CSS blur for privacy: when enabled the sensitive string is
// replaced in the accessibility tree and rendered page with a neutral token.
export function PrivacyValue({ children, className }: { children: ReactNode; className?: string }) {
  const hidden = usePrivacyHidden();
  return <span className={className} aria-label={hidden ? 'סכום מוסתר' : undefined}>{hidden ? '₪••••' : children}</span>;
}

export function PrivacySlot({ children }: { children: ReactNode }) {
  return usePrivacyHidden() ? null : <>{children}</>;
}
