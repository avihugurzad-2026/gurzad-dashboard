import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sbAdmin } from './_lib/server.js';

export type SiteConversion = {
  id: string;
  name: string;
  type: 'form' | 'whatsapp' | 'phone' | 'button' | 'page';
  selector: string;
  primary?: boolean;
  value?: number;
  google_ads?: boolean;
  google_conversion_label?: string;
  last_tested_at?: string;
};

type CachedSite = {
  id: string;
  workspace_id: string;
  domain: string;
  data: Record<string, any>;
  exp: number;
};

const siteCache = new Map<string, CachedSite>();

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cleanDomain(raw?: string): string {
  if (!raw) return '';
  let s = raw.trim().toLowerCase();
  try {
    if (s.includes('://')) s = new URL(s).hostname;
  } catch { /* ignore */ }
  return s.replace(/^www\./, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}

function domainMatches(allowed: string, host: string): boolean {
  const a = cleanDomain(allowed);
  const h = cleanDomain(host);
  if (!a) return true;
  if (!h) return false;
  return h === a || h.endsWith(`.${a}`);
}

async function findSiteByKey(siteKey: string): Promise<CachedSite | null> {
  if (!siteKey || siteKey.length > 80) return null;
  const hit = siteCache.get(siteKey);
  if (hit && hit.exp > Date.now()) return hit;
  const sb = sbAdmin();
  const { data } = await sb
    .from('gd_records')
    .select('id, workspace_id, data')
    .eq('collection', 'monitors')
    .contains('data', { site_key: siteKey })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const d = (data.data || {}) as Record<string, any>;
  const entry: CachedSite = {
    id: data.id,
    workspace_id: data.workspace_id,
    domain: cleanDomain(d.domain || d.url),
    data: d,
    exp: Date.now() + 60_000,
  };
  siteCache.set(siteKey, entry);
  return entry;
}

function parseDevice(ua: string, vw?: number): 'mobile' | 'tablet' | 'desktop' {
  if (/ipad|tablet|playbook|silk|(android(?!.*mobi))/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|iemobile|opera mini/i.test(ua)) return 'mobile';
  if (typeof vw === 'number' && vw > 0) {
    if (vw < 768) return 'mobile';
    if (vw < 1024) return 'tablet';
  }
  return 'desktop';
}

function parseBrowser(ua: string): string {
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\/|Opera/i.test(ua)) return 'Opera';
  if (/Firefox|FxiOS/i.test(ua)) return 'Firefox';
  if (/Chrome|CriOS/i.test(ua)) return 'Chrome';
  if (/Safari/i.test(ua)) return 'Safari';
  return 'אחר';
}

function parseSource(referrer: string, utmSource: string, siteDomain: string): string {
  const utm = (utmSource || '').trim();
  if (utm) {
    const low = utm.toLowerCase();
    if (low === 'ig' || low === 'instagram') return utm === 'ig' ? 'ig' : 'Instagram';
    if (low === 'fb' || low === 'facebook') return utm === 'fb' ? 'fb' : 'Facebook';
    if (low === 'google' || low === 'gads' || low === 'adwords') return 'Google';
    if (low === 'youtube' || low === 'yt') return 'YouTube';
    if (low === 'bing') return 'Bing';
    return utm.slice(0, 60);
  }
  if (!referrer) return 'ישיר';
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase();
    if (!host || (siteDomain && domainMatches(siteDomain, host))) return 'ישיר';
    if (host.includes('google.')) return 'Google';
    if (host === 'l.instagram.com' || host.endsWith('instagram.com')) return 'Instagram';
    if (host === 'l.facebook.com' || host === 'lm.facebook.com' || host === 'm.facebook.com' || host.endsWith('facebook.com') || host === 'fb.me') return 'Facebook';
    if (host.includes('youtube.com') || host === 'youtu.be') return 'YouTube';
    if (host.includes('bing.com')) return 'Bing';
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt.com';
    if (host.includes('tiktok.com')) return 'TikTok';
    if (host.includes('linkedin.com')) return 'LinkedIn';
    if (host.includes('t.co') || host.includes('twitter.com') || host.includes('x.com')) return 'X';
    if (host.includes('whatsapp.com') || host === 'wa.me') return 'WhatsApp';
    return host.slice(0, 60);
  } catch {
    return 'ישיר';
  }
}

const COUNTRY_HE: Record<string, string> = {
  IL: 'ישראל',
  US: 'ארה״ב',
  GB: 'בריטניה',
  DE: 'גרמניה',
  FR: 'צרפת',
  CA: 'קנדה',
  NL: 'הולנד',
  ES: 'ספרד',
  IT: 'איטליה',
  AU: 'אוסטרליה',
  UA: 'אוקראינה',
  RU: 'רוסיה',
  CY: 'קפריסין',
  GR: 'יוון',
  AE: 'איחוד האמירויות',
};

function parseCountry(code?: string | string[]): string {
  const c = Array.isArray(code) ? code[0] : code;
  if (!c || c === 'XX' || c === 'T1') return 'לא ידוע';
  const up = c.trim().toUpperCase();
  return COUNTRY_HE[up] || up;
}

function buildTrackerScript(origin: string, siteKey: string, conversions: SiteConversion[]): string {
  const cfg = JSON.stringify({
    e: `${origin}/api/t`,
    s: siteKey,
    c: conversions.map((c) => ({
      id: c.id,
      n: c.name,
      t: c.type,
      sel: c.selector || '',
      v: c.value ?? null,
      ga: !!c.google_ads,
    })),
  });

  return `(function(){
if(window.__gdTrackerLoaded)return;window.__gdTrackerLoaded=1;
var C=${cfg};
var L=location,D=document,S=sessionStorage,LS=localStorage;
var qs=new URLSearchParams(L.search);
if(qs.get('gd_debug')==='1'||qs.get('bzst')==='debug'){try{S.setItem('__gd_dbg','1')}catch(e){}}
if(qs.get('gd_debug')==='0'||qs.get('bzst')==='nodebug'){try{S.removeItem('__gd_dbg')}catch(e){}}
var DBG=false;try{DBG=S.getItem('__gd_dbg')==='1'}catch(e){}
function rnd(){return Math.random().toString(36).slice(2)+Date.now().toString(36)}
var vid,isNew=false;
try{vid=LS.getItem('__gd_vid');if(!vid){vid=rnd();LS.setItem('__gd_vid',vid);isNew=true}}catch(e){vid=rnd();isNew=true}
var sid;
try{var raw=S.getItem('__gd_sid');var p=raw?raw.split(':'):[];if(p[0]&&Date.now()-Number(p[1])<18e5){sid=p[0]}else{sid=rnd()}S.setItem('__gd_sid',sid+':'+Date.now())}catch(e){sid=rnd()}
var utmS=qs.get('utm_source')||'',utmM=qs.get('utm_medium')||'',utmC=qs.get('utm_campaign')||'',gclid=qs.get('gclid')||'';
try{if(gclid)S.setItem('__gd_gclid',gclid);else gclid=S.getItem('__gd_gclid')||''}catch(e){}
try{if(utmS)S.setItem('__gd_us',utmS);else utmS=S.getItem('__gd_us')||''}catch(e){}
var startAt=Date.now(),lastPath='',bar=null;
function showDebug(msg){
  if(!DBG)return;
  if(!bar){
    bar=D.createElement('div');
    bar.style.cssText='position:fixed;bottom:14px;left:14px;right:14px;max-width:520px;margin:auto;z-index:2147483647;background:#17181a;color:#f5f5f6;font:13px/1.5 system-ui,sans-serif;direction:rtl;padding:10px 14px;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:space-between;gap:10px';
    D.body&&D.body.appendChild(bar);
  }
  bar.innerHTML='<span><b style="color:#EEF27A">מצב בדיקה</b> · '+msg+' (לא נספר)</span><a href="?gd_debug=0" style="color:#EEF27A;text-decoration:underline;white-space:nowrap">סיום</a>';
}
function send(payload){
  var body=JSON.stringify(payload);
  if(navigator.sendBeacon){try{navigator.sendBeacon(C.e,new Blob([body],{type:'text/plain'}));return}catch(e){}}
  try{fetch(C.e,{method:'POST',body:body,keepalive:true,mode:'cors',headers:{'Content-Type':'text/plain'}}).catch(function(){})}catch(e){}
}
function base(kind){
  return {s:C.s,k:kind,v:vid,sid:sid,n:isNew,p:L.pathname||'/',t:(D.title||'').slice(0,180),r:D.referrer||'',us:utmS,um:utmM,uc:utmC,gc:gclid,vw:window.innerWidth||0,h:L.hostname,dbg:DBG};
}
function fireConv(c){
  if(DBG){showDebug('זוהתה המרה: '+c.n);send(Object.assign(base('conversion'),{cid:c.id,cn:c.n,cv:c.v,ga:c.ga}));return}
  send(Object.assign(base('conversion'),{cid:c.id,cn:c.n,cv:c.v,ga:c.ga}));
}
function trackPage(){
  var p=L.pathname||'/';if(p===lastPath)return;lastPath=p;startAt=Date.now();
  if(DBG){showDebug('צפייה בדף '+p)}else{send(base('pageview'))}
  for(var i=0;i<C.c.length;i++){
    var c=C.c[i];
    if(c.t==='page'&&c.sel&&p.toLowerCase().indexOf(c.sel.toLowerCase())!==-1)fireConv(c);
  }
}
function ping(){
  if(DBG)return;
  var sec=Math.min(1800,Math.max(1,Math.round((Date.now()-startAt)/1000)));
  send(Object.assign(base('ping'),{d:sec}));
}
function matchEl(el,sel){
  if(!el||!sel)return false;
  var s=sel.trim();
  if(!s)return false;
  try{if(el.matches&&(el.matches(s)||el.closest(s)))return true}catch(e){}
  if(el.id&&el.id===s.replace(/^#/,''))return true;
  if(el.name&&el.name===s)return true;
  var txt=(el.innerText||el.textContent||'').trim();
  if(txt&&txt.indexOf(s)!==-1)return true;
  return false;
}
D.addEventListener('submit',function(e){
  var f=e.target;
  for(var i=0;i<C.c.length;i++){
    var c=C.c[i];
    if(c.t==='form'&&(!c.sel||matchEl(f,c.sel)))fireConv(c);
  }
},true);
D.addEventListener('click',function(e){
  var el=e.target&&e.target.closest?e.target.closest('a,button,[role="button"],input[type="submit"]')||e.target:e.target;
  if(!el)return;
  var href=(el.getAttribute&&el.getAttribute('href'))||'';
  for(var i=0;i<C.c.length;i++){
    var c=C.c[i];
    if(c.t==='whatsapp'&&(/(wa\.me|api\.whatsapp\.com|whatsapp:)/i.test(href)||(c.sel&&matchEl(el,c.sel))))fireConv(c);
    else if(c.t==='phone'&&(/^tel:/i.test(href)||(c.sel&&matchEl(el,c.sel))))fireConv(c);
    else if(c.t==='button'&&c.sel&&matchEl(el,c.sel))fireConv(c);
  }
},true);
var ps=history.pushState;
if(ps){history.pushState=function(){var r=ps.apply(this,arguments);setTimeout(trackPage,50);return r}}
window.addEventListener('popstate',function(){setTimeout(trackPage,50)});
D.addEventListener('visibilitychange',function(){if(D.visibilityState==='hidden')ping()});
window.addEventListener('pagehide',ping);
setInterval(function(){if(D.visibilityState==='visible')ping()},30000);
if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',trackPage);else trackPage();
})();`;
}

export default async function trackerHandler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Serve tracking script: GET /api/t?s=<site_key>
  if (req.method === 'GET') {
    const siteKey = String(req.query.s || '').trim();
    if (!siteKey) {
      res.status(400).setHeader('Content-Type', 'application/javascript; charset=utf-8').send('/* missing site key */');
      return;
    }
    try {
      const site = await findSiteByKey(siteKey);
      const conversions: SiteConversion[] = Array.isArray(site?.data?.conversions) ? site!.data.conversions : [];
      const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
      const origin = `${proto}://${host}`;
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
      res.status(200).send(buildTrackerScript(origin, siteKey, conversions));
    } catch {
      res.status(200).setHeader('Content-Type', 'application/javascript; charset=utf-8').send('/* tracker unavailable */');
    }
    return;
  }

  // Ingest event: POST /api/t
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const siteKey = String(body.s || '').trim();
      const kind = String(body.k || '');
      if (!siteKey || !['pageview', 'ping', 'conversion'].includes(kind)) {
        res.status(204).end();
        return;
      }

      const site = await findSiteByKey(siteKey);
      if (!site) {
        res.status(204).end();
        return;
      }

      const reqHost = cleanDomain(String(body.h || req.headers.origin || ''));
      const sb = sbAdmin();

      // Learn domain on first visit if left blank
      if (!site.domain && reqHost && !/^(localhost|127\.0\.0\.1)$/.test(reqHost)) {
        site.domain = reqHost;
        site.data = { ...site.data, domain: reqHost, url: site.data.url || `https://${reqHost}` };
        await sb.from('gd_records').update({ data: site.data }).eq('id', site.id);
      } else if (site.domain && reqHost && !domainMatches(site.domain, reqHost)) {
        res.status(204).end();
        return;
      }

      const visitorId = String(body.v || '').slice(0, 64);
      const sessionId = String(body.sid || '').slice(0, 64);
      if (!visitorId || !sessionId) {
        res.status(204).end();
        return;
      }

      // Debug mode conversion: only stamp last_tested_at, do not count
      if (body.dbg) {
        if (kind === 'conversion' && body.cid && Array.isArray(site.data.conversions)) {
          const updated = site.data.conversions.map((c: any) =>
            c.id === body.cid ? { ...c, last_tested_at: new Date().toISOString() } : c,
          );
          site.data = { ...site.data, conversions: updated };
          await sb.from('gd_records').update({ data: site.data }).eq('id', site.id);
        }
        res.status(204).end();
        return;
      }

      // Heartbeat / duration update on the latest pageview of this session
      if (kind === 'ping') {
        const dur = Math.min(1800, Math.max(0, Number(body.d) || 0));
        const { data: lastPv } = await sb
          .from('gd_site_events')
          .select('id, duration_sec')
          .eq('site_id', site.id)
          .eq('session_id', sessionId)
          .eq('kind', 'pageview')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastPv) {
          await sb
            .from('gd_site_events')
            .update({
              duration_sec: Math.max(Number(lastPv.duration_sec) || 0, dur),
              last_seen_at: new Date().toISOString(),
            })
            .eq('id', lastPv.id);
        }
        res.status(204).end();
        return;
      }

      const ua = String(req.headers['user-agent'] || '');
      const device = parseDevice(ua, Number(body.vw) || undefined);
      const browser = parseBrowser(ua);
      const source = parseSource(String(body.r || ''), String(body.us || ''), site.domain);
      const country = parseCountry(req.headers['x-vercel-ip-country']);
      const gclid = String(body.gc || '').slice(0, 120) || null;
      const utmSource = String(body.us || '').slice(0, 80) || null;
      const utmMedium = String(body.um || '').slice(0, 80) || null;
      const utmCampaign = String(body.uc || '').slice(0, 120) || null;
      const fromAds = !!(gclid || /cpc|ppc|paid|ads/i.test(utmMedium || '') || /gads|adwords/i.test(utmSource || ''));

      await sb.from('gd_site_events').insert({
        workspace_id: site.workspace_id,
        site_id: site.id,
        kind,
        visitor_id: visitorId,
        session_id: sessionId,
        is_new: !!body.n,
        path: String(body.p || '/').slice(0, 260),
        title: String(body.t || '').slice(0, 200) || null,
        referrer: source,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        gclid,
        device,
        browser,
        country,
        duration_sec: 0,
        conversion_id: kind === 'conversion' ? String(body.cid || '').slice(0, 80) || null : null,
        conversion_name: kind === 'conversion' ? String(body.cn || '').slice(0, 120) || null : null,
        conversion_value: kind === 'conversion' && body.cv != null ? Number(body.cv) : null,
        from_ads: fromAds,
        google_sent: kind === 'conversion' && fromAds && !!body.ga,
      });
    } catch {
      // Never leak server details to tracking beacons
    }
    res.status(204).end();
    return;
  }

  res.status(405).end();
}
