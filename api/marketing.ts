import { handler, HttpError, requireMember, sbAdmin } from './_lib/server.js';
import { metaMissing, metaReady, metaReport } from './_lib/meta.js';
import {
  campaignsAccountDetail,
  campaignsOverview,
  executeVerifiedRecommendation,
  getMetaWaSchedule,
  listVerifiedActionLogs,
  metaAgentLiveChat,
  metaCampaignsReady,
  runMetaDailyAgent,
  saveMetaWaSchedule,
  sendMetaYesterdayWhatsAppReport,
  setMetaEntityStatus,
  updateRecommendationState,
  verifyMetaEntityLive,
} from './_lib/meta-campaigns.js';
import { serviceEmail, siteReport, sitesReady } from './_lib/analytics.js';
import { portfolioReport, siteDetailReport } from './_lib/tracker.js';

// GET ?source=meta&days=28                                       → Meta reach (paid + organic) for the configured business
// GET ?source=campaigns_overview&days=7[&since=...&until=...]    → Multi-account Adigital Meta Ads overview + agent queue
// GET ?source=campaigns_account&accountId=...&days=14            → Single client daily + campaign + ad drill-down
// GET ?source=sites_overview&days=28                             → Portfolio view of all sites (first-party tracker)
// GET ?source=site_detail&id=<id>&days=28                        → Single site detail (first-party tracker + optional GA4/GSC)
// GET ?source=site&id=<monitor>&days=28                          → Legacy GA4 + Search Console for one site
// GET ?source=setup                                              → which connections are configured (no data)
// POST { action: 'run_agent' | 'set_entity_status' | 'rec_state' }
export default handler(async (req, res) => {
  const m = await requireMember(req);
  const canMeta = m.role === 'owner' || (m.areas ?? []).includes('meta_campaigns');
  if (m.role !== 'owner' && !(m.areas ?? []).includes('business') && !canMeta) throw new HttpError(403, 'אין גישה לשיווק');

  if (req.method === 'POST') {
    if (!canMeta) throw new HttpError(403, 'אין הרשאה לניהול קמפיינים במטא');
    const b = req.body ?? {};
    if (b.action === 'run_agent') {
      const days = [1, 3, 7, 14, 28, 30].includes(Number(b.days)) ? Number(b.days) : 7;
      res.json(await runMetaDailyAgent(m.workspaceId, days));
      return;
    }
    if (b.action === 'rec_state') {
      const state = ['pending', 'approved', 'skipped', 'executed'].includes(String(b.state)) ? b.state : 'pending';
      res.json(await updateRecommendationState(m.workspaceId, String(b.recId || ''), state));
      return;
    }
    if (b.action === 'set_entity_status') {
      if (m.role !== 'owner') throw new HttpError(403, 'רק בעל המערכת רשאי לבצע שינויים בחשבונות המודעות');
      const status = b.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED';
      res.json(
        await executeVerifiedRecommendation(m.workspaceId, {
          recId: b.recId ? String(b.recId) : undefined,
          kind: status === 'ACTIVE' ? 'activate_ad' : 'pause_ad',
          accountId: String(b.accountId || ''),
          accountName: String(b.accountName || ''),
          targetEntityId: String(b.entityId || ''),
          targetEntityName: b.entityName ? String(b.entityName) : undefined,
        }),
      );
      return;
    }
    if (b.action === 'execute_rec') {
      if (m.role !== 'owner') throw new HttpError(403, 'רק בעל המערכת רשאי לבצע שינויים בחשבונות המודעות');
      const kind = b.kind === 'scale_budget' ? 'scale_budget' : b.kind === 'activate_ad' ? 'activate_ad' : 'pause_ad';
      res.json(
        await executeVerifiedRecommendation(m.workspaceId, {
          recId: b.recId ? String(b.recId) : undefined,
          kind,
          accountId: String(b.accountId || ''),
          accountName: String(b.accountName || ''),
          targetEntityId: b.targetEntityId ? String(b.targetEntityId) : undefined,
          targetEntityName: b.targetEntityName ? String(b.targetEntityName) : undefined,
          deltaPct: b.deltaPct != null ? Number(b.deltaPct) : 20,
        }),
      );
      return;
    }
    if (b.action === 'agent_chat') {
      res.json(
        await metaAgentLiveChat(
          m.workspaceId,
          String(b.message || '').slice(0, 2000),
          Array.isArray(b.history) ? b.history : [],
          m.role === 'owner',
        ),
      );
      return;
    }
    if (b.action === 'save_wa_schedule') {
      if (m.role !== 'owner') throw new HttpError(403, 'רק בעל המערכת רשאי לשנות הגדרות תזמון');
      res.json(
        await saveMetaWaSchedule(m.workspaceId, {
          enabled: b.enabled,
          days: b.days,
          hour: b.hour,
          phone: b.phone,
          includeRecommendations: b.includeRecommendations,
        }),
      );
      return;
    }
    if (b.action === 'send_wa_report_now') {
      if (m.role !== 'owner') throw new HttpError(403, 'רק בעל המערכת');
      res.json(await sendMetaYesterdayWhatsAppReport(m.workspaceId, { forceTest: true }));
      return;
    }
    throw new HttpError(400, 'פעולה לא מוכרת');
  }

  const days = [1, 3, 7, 14, 28, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 28;
  const since = req.query.since ? String(req.query.since) : undefined;
  const until = req.query.until ? String(req.query.until) : undefined;
  const source = String(req.query.source || 'setup');

  if (source === 'setup') {
    res.json({
      meta: { ready: metaReady(), missing: metaMissing() },
      metaCampaigns: { ready: metaCampaignsReady() },
      sites: { ready: sitesReady(), serviceEmail: serviceEmail(), tracker: true },
    });
    return;
  }
  if (source === 'campaigns_overview') {
    if (!canMeta) throw new HttpError(403, 'אין הרשאה לקמפיינים במטא');
    const d = req.query.days ? days : 7;
    const [ov, actionLogs] = await Promise.all([
      campaignsOverview(m.workspaceId, { days: d, since, until, force: req.query.force === '1' }),
      listVerifiedActionLogs(m.workspaceId),
    ]);
    res.json({ ...ov, actionLogs });
    return;
  }
  if (source === 'verify_entity') {
    if (!canMeta) throw new HttpError(403, 'אין הרשאה לקמפיינים במטא');
    const entityId = String(req.query.entityId || '');
    res.json(await verifyMetaEntityLive(entityId));
    return;
  }
  if (source === 'wa_schedule') {
    if (!canMeta) throw new HttpError(403, 'אין הרשאה לקמפיינים במטא');
    res.json(await getMetaWaSchedule(m.workspaceId));
    return;
  }
  if (source === 'campaigns_account') {
    if (!canMeta) throw new HttpError(403, 'אין הרשאה לקמפיינים במטא');
    const accountId = String(req.query.accountId || '');
    if (!accountId) throw new HttpError(400, 'חסר מזהה חשבון');
    const d = req.query.days ? days : 14;
    res.json(await campaignsAccountDetail(accountId, { days: d, since, until }));
    return;
  }
  if (source === 'meta') {
    if (!metaReady()) { res.json({ configured: false, missing: metaMissing() }); return; }
    res.json(await metaReport(days));
    return;
  }
  if (source === 'sites_overview') {
    res.json(await portfolioReport(m.workspaceId, days));
    return;
  }
  if (source === 'site_detail') {
    const id = String(req.query.id || '');
    const { data: row } = await sbAdmin().from('gd_records').select('id, data').eq('id', id).eq('workspace_id', m.workspaceId).eq('collection', 'monitors').maybeSingle();
    if (!row) throw new HttpError(404, 'האתר לא נמצא');
    const detail = await siteDetailReport(m.workspaceId, row, days);
    let google: { ga: any; search: any; warnings: string[] } | null = null;
    const s = row.data as any;
    if (sitesReady() && (s.ga_property || s.gsc_site || s.url)) {
      try {
        google = await siteReport({ url: s.url, ga: s.ga_property, gsc: s.gsc_site, days });
      } catch {
        google = null;
      }
    }
    res.json({ ...detail, google });
    return;
  }
  if (source === 'site') {
    if (!sitesReady()) { res.json({ configured: false }); return; }
    const id = String(req.query.id || '');
    const { data: row } = await sbAdmin().from('gd_records').select('data').eq('id', id).eq('workspace_id', m.workspaceId).eq('collection', 'monitors').maybeSingle();
    if (!row) throw new HttpError(404, 'האתר לא נמצא');
    const s = row.data as any;
    if (!s.ga_property && !s.gsc_site && !s.url) { res.json({ configured: true, ga: null, search: null, warnings: [] }); return; }
    res.json({ configured: true, ...(await siteReport({ url: s.url, ga: s.ga_property, gsc: s.gsc_site, days })) });
    return;
  }
  throw new HttpError(400, 'מקור לא מוכר');
});
