import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, KeyRound, Plug, RefreshCw, TrendingUp, Unplug } from 'lucide-react';
import type { Rec } from '../../data/types';
import { api } from '../../lib/api';
import { DEMO } from '../../lib/config';
import { money, monthName, number, shortDate } from '../../lib/format';
import { BarChart } from '../../ui/charts';
import { Badge, Card, CardHead, Empty, Kpi } from '../../ui/kit';
import type { ConnectionView, ProviderInfo, RevenueSnapshot } from '../../../shared/integrations';
import { setBizConnections } from '../../lib/bizRevenue';

const TONE = 'var(--tone-business)';
type Resp = { providers: ProviderInfo[]; connections: ConnectionView[] };

/** API keys of one business's systems (stored encrypted on the server). Lives in Settings; the data shows on the business page. */
export function IntegrationsPanel({ biz }: { biz: Rec }) {
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr('');
    api<Resp>(`/api/integrations?business=${encodeURIComponent(biz.id)}`).then((r) => { setData(r); setBizConnections(biz.id, r.connections); }).catch((e) => setErr(e.message));
  }, [biz.id]);
  useEffect(() => { if (!DEMO) load(); }, [load]);

  async function act(provider: string, action: 'sync' | 'disconnect') {
    if (action === 'disconnect' && !confirm('לנתק את החיבור? המפתח יימחק מהשרת והנתונים האחרונים יישמרו.')) return;
    setBusy(provider); setErr('');
    try { const r = await api<{ connections: ConnectionView[] }>('/api/integrations', { body: { action, business: biz.id, provider } }); setData((d) => d && { ...d, connections: r.connections }); setBizConnections(biz.id, r.connections); }
    catch (e: any) { setErr(e.message); load(); }
    finally { setBusy(''); }
  }

  if (DEMO) return <Card className="soft lg-12"><CardHead title="חיבורי API" /><p className="meta">בהדגמה אין חיבור אמיתי. בגרסה המחוברת מדביקים כאן מפתח API של מערכת העסק.</p></Card>;
  if (!data) return <Card className="soft lg-12"><CardHead title="חיבורי API" />{err ? <p className="neg"><CircleAlert size={14} /> {err}</p> : <p className="meta">טוען…</p>}</Card>;

  return (
    <>
      {data.providers.map((p) => {
        const c = data.connections.find((x) => x.provider === p.id);
        const live = c && c.status !== 'disconnected';
        return (
          <Card key={p.id} className="lg-6 md-12">
            <CardHead title={<><Plug size={16} /> {p.name}</>} sub={p.kind}>
              {live ? <Badge kind={c.status === 'connected' ? 'pos' : 'neg'}>{c.status === 'connected' ? 'מחובר' : 'שגיאה'}</Badge> : <Badge>לא מחובר</Badge>}
            </CardHead>
            {live ? (
              <>
                <p className="meta">
                  מפתח שמסתיים ב־<bdi dir="ltr">…{c.keyHint}</bdi>
                  {c.lastSyncAt ? <> · סונכרן {shortDate(c.lastSyncAt.slice(0, 10))} {new Date(c.lastSyncAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</> : ' · טרם סונכרן'}
                </p>
                {c.lastError && <p className="neg" style={{ marginTop: 6 }}><CircleAlert size={14} /> {c.lastError}</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="btn btn-soft btn-sm" disabled={!!busy} onClick={() => act(p.id, 'sync')}><RefreshCw size={14} className={busy === p.id ? 'spin' : ''} />סנכרון עכשיו</button>
                  <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => setOpen(open === p.id ? null : p.id)}><KeyRound size={14} />החלפת מפתח</button>
                  <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => act(p.id, 'disconnect')}><Unplug size={14} />ניתוק</button>
                </div>
              </>
            ) : (
              <>
                <p className="meta">{p.description}</p>
                <p className="meta" style={{ marginTop: 6 }}>מה נמשך: {p.provides.join(' · ')}</p>
                {open !== p.id && <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => setOpen(p.id)}><KeyRound size={14} />חיבור</button>}
              </>
            )}
            {open === p.id && <ConnectForm biz={biz} p={p} onDone={(conns) => { setOpen(null); setData((d) => d && { ...d, connections: conns }); setBizConnections(biz.id, conns); }} onCancel={() => setOpen(null)} />}
            {err && busy === '' && open === null && <p className="neg" style={{ marginTop: 8 }}><CircleAlert size={14} /> {err}</p>}
          </Card>
        );
      })}
    </>
  );
}

function ConnectForm({ biz, p, onDone, onCancel }: { biz: Rec; p: ProviderInfo; onDone: (c: ConnectionView[]) => void; onCancel: () => void }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg('');
    try {
      const r = await api<{ message: string; connections: ConnectionView[] }>('/api/integrations', { body: { action: 'connect', business: biz.id, provider: p.id, fields } });
      setFields({}); onDone(r.connections);
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="form" style={{ marginTop: 14 }} autoComplete="off">
      {p.fields.map((f) => (
        <label key={f.key} className="field full">
          <span>{f.label}{f.optional ? ' (רשות)' : ''}</span>
          <input className="input" dir="ltr" style={{ textAlign: 'right' }} type={f.secret ? 'password' : 'text'} autoComplete={f.secret ? 'new-password' : 'off'}
            placeholder={f.placeholder} required={!f.optional} value={fields[f.key] ?? ''} onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))} />
          {f.help && <small className="meta">{f.help}</small>}
        </label>
      ))}
      <p className="meta full">המפתח נבדק מול {p.name}, נשמר מוצפן בשרת ולא מוצג שוב.</p>
      {msg && <p className="neg full"><CircleAlert size={14} /> {msg}</p>}
      <div className="full" style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'בודק…' : 'בדיקה ושמירה'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>ביטול</button>
      </div>
    </form>
  );
}

/** Details pulled from a connected system, shown on the business overview. k scales amounts (my share). */
export function RevenueView({ name, snap, k = 1 }: { name: string; snap: RevenueSnapshot; k?: number }) {
  const s = snap.summary;
  const hasMonthly = snap.monthly.some((m) => m.total > 0);
  return (
    <>
      <Card className="lg-3 md-6 sm-6"><Kpi label={`מחזור החודש · ${name}`} icon={TrendingUp} tone={TONE} value={money(s.total * k)} foot={snap.vatIncluded === false ? 'לפני מע״מ' : 'כפי שמופק (כולל מע״מ)'} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="עסקאות החודש" tone={TONE} value={number(s.count)} foot={s.average ? `ממוצע ${money(s.average)}` : undefined} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="ממתין לתשלום" tone={TONE} value={money(s.unpaid * k)} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="אמצעי תשלום מוביל" tone={TONE} value={snap.methods[0]?.label || 'אין נתונים עדיין'} foot={snap.methods[0] ? money(snap.methods[0].total * k) : undefined} /></Card>
      <Card className="lg-8 md-12">
        <CardHead title={`הכנסות לפי חודש · ${name}`} sub={snap.range.monthsFrom ? `${monthName(snap.range.monthsFrom)} – ${monthName(snap.range.monthsTo)}` : undefined} />
        {hasMonthly ? <BarChart data={snap.monthly.map((m) => ({ month: m.month, a: m.total * k }))} aLabel="הכנסות" height={220} width={720} /> : <Empty icon={TrendingUp} title="אין נתונים עדיין" />}
      </Card>
      <Card className="lg-4 md-12">
        <CardHead title={snap.sellersTitle ?? 'מכירות לפי מוכרנית'} sub="החודש" />
        {snap.sellers.length ? (
          <ul className="list">{snap.sellers.slice(0, 6).map((x) => <li key={x.name} className="spread"><bdi>{x.name}</bdi><span className="li-amount">{money(x.total * k)}</span></li>)}</ul>
        ) : <p className="meta">אין נתונים עדיין</p>}
      </Card>
    </>
  );
}
