import { handler, HttpError, requireMember, sbAdmin } from './_lib/server.js';
import { metaMissing, metaReady, metaReport } from './_lib/meta.js';
import { serviceEmail, siteReport, sitesReady } from './_lib/analytics.js';
import { portfolioReport, siteDetailReport } from './_lib/tracker.js';

// GET ?source=meta&days=28                 → Meta reach (paid + organic) for the configured business
// GET ?source=sites_overview&days=28       → Portfolio view of all sites (first-party tracker)
// GET ?source=site_detail&id=<id>&days=28  → Single site detail (first-party tracker + optional GA4/GSC)
// GET ?source=site&id=<monitor>&days=28    → Legacy GA4 + Search Console for one site
// GET ?source=setup                        → which connections are configured (no data)
export default handler(async (req, res) => {
  const m = await requireMember(req);
  if (m.role !== 'owner' && !(m.areas ?? []).includes('business')) throw new HttpError(403, 'אין גישה לשיווק');
  const days = [7, 28, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 28;
  const source = String(req.query.source || 'setup');

  if (source === 'setup') {
    res.json({
      meta: { ready: metaReady(), missing: metaMissing() },
      sites: { ready: sitesReady(), serviceEmail: serviceEmail(), tracker: true },
    });
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
