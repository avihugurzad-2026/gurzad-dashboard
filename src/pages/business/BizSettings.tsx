import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { LayoutGrid, Percent } from 'lucide-react';
import { store, useCollection } from '../../data/store';
import { Card, CardHead, Stagger, Toggle, spring } from '../../ui/kit';
import type { Rec } from '../../data/types';
import { bizTabs } from './BusinessArea';
import { isAdigitalBusiness } from './MetaCampaignsPage';
import { IntegrationsPanel } from './IntegrationsPanel';

/** Settings → per business: my ownership share and the API keys of its systems (Buyz, Morning…). */
export function BizSettings() {
  const businesses = useCollection('businesses');
  const [id, setId] = useState<string | null>(null);
  const biz = businesses.find((b) => b.id === id) ?? businesses[0];
  if (!biz) return null;
  return (
    <>
      <div className="card-head" style={{ marginTop: 28, marginBottom: 12, padding: '0 4px' }}>
        <div><h2>העסקים שלי</h2><div className="sub">אחוז הבעלות שלך, ומפתחות API של המערכות של כל עסק. הנתונים מתעדכנים לבד ומוצגים בדף העסק.</div></div>
      </div>
      <div className="chips" style={{ marginBottom: 14 }} role="group" aria-label="בחירת עסק">
        {businesses.map((b) => {
          const on = b.id === biz.id;
          return (
            <button key={b.id} aria-pressed={on} className="chip" style={{ position: 'relative', background: on ? 'transparent' : undefined, borderColor: on ? 'transparent' : undefined }} onClick={() => setId(b.id)}>
              {on && <motion.span layoutId="bizset-chip" transition={spring} style={{ position: 'absolute', inset: -1, borderRadius: 999, background: 'var(--accent)' }} />}
              <span className="chip-text" title={b.name}>{b.name}</span>
            </button>
          );
        })}
      </div>
      <Stagger key={biz.id}>
        <OwnershipCard bizId={biz.id} name={biz.name} pct={biz.owner_pct ?? 100} />
        <TabsCard biz={biz} />
        <IntegrationsPanel biz={biz} />
      </Stagger>
    </>
  );
}

function OwnershipCard({ bizId, name, pct }: { bizId: string; name: string; pct: number }) {
  const [v, setV] = useState(String(pct));
  const [saved, setSaved] = useState(false);
  useEffect(() => setV(String(pct)), [pct, bizId]);
  const n = Number(v);
  const valid = v.trim() !== '' && Number.isFinite(n) && n > 0 && n <= 100;
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || n === pct) return;
    store.update('businesses', bizId, { owner_pct: Math.round(n * 100) / 100 });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }
  return (
    <Card className="lg-6 md-12">
      <CardHead title={<><Percent size={16} /> החלק שלי ב{name}</>} sub="לפי האחוז הזה הדשבורד מחשב כמה הכנסת וכמה הרווחת אתה" />
      <form onSubmit={save} className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="row" style={{ gap: 8 }}>
          <input className="input num" style={{ width: 110 }} inputMode="decimal" type="number" min={1} max={100} step="0.5" value={v} onChange={(e) => setV(e.target.value)} aria-label="אחוז בעלות" />
          <span>%</span>
        </label>
        <button className="btn btn-primary btn-sm" disabled={!valid || n === pct}>שמירה</button>
        {saved && <span className="meta">נשמר</span>}
        {!valid && <span className="neg">מספר בין 1 ל־100</span>}
      </form>
    </Card>
  );
}

function TabsCard({ biz }: { biz: Rec }) {
  const hidden: string[] = Array.isArray(biz.hidden_tabs) ? biz.hidden_tabs : [];
  const tabs = bizTabs(isAdigitalBusiness(biz)).filter((t) => t.value !== 'overview');
  const set = (value: string, on: boolean) =>
    store.update('businesses', biz.id, { hidden_tabs: on ? hidden.filter((x) => x !== value) : [...new Set([...hidden, value])] });
  return (
    <Card className="lg-6 md-12">
      <CardHead title={<><LayoutGrid size={16} /> מה מוצג בדף העסק</>} sub="מצב כספי מוצג תמיד" />
      <div className="stack" style={{ gap: 10 }}>
        {tabs.map((t) => (
          <label key={t.value} className="switch"><span className="row"><t.icon size={16} />{t.label}</span><Toggle checked={!hidden.includes(t.value)} onChange={(v) => set(t.value, v)} label={t.label} /></label>
        ))}
      </div>
    </Card>
  );
}
