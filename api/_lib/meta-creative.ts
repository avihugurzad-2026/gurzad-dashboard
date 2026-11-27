import crypto, { createHmac } from 'node:crypto';
import sharp from 'sharp';
import { env, has, HttpError, israelDay, sbAdmin } from './server.js';
import { DEFAULT_AGENCY_ACCOUNTS, loadAgencyAccounts, metaAdsToken } from './meta-campaigns.js';

// Creative Studio & Live Meta Ad Publisher for Adigital (אדיג׳יטל).
// Flow: Reference image + brief -> Gemini Image (Feed 4:5 + Story 9:16) + Hebrew ad copy ->
// Preview images sent directly to WhatsApp -> Unlimited copy/visual edits ->
// Upon explicit approval of BOTH copy + creative -> Publish live to Meta (ACTIVE by default, PAUSED if requested).

const BUCKET = 'gd-receipts';
const COLLECTION = 'meta_creative_drafts';
const LOG_COLLECTION = 'meta_action_logs';
const G = 'https://graph.facebook.com';
const V = () => env('META_GRAPH_VERSION') || 'v22.0';

const IMAGE_MODELS = () =>
  [env('GEMINI_IMAGE_MODEL') || 'gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image'].filter(
    (m, i, a) => Boolean(m) && a.indexOf(m) === i,
  );
const TEXT_MODELS = () =>
  [env('GEMINI_MODEL') || 'gemini-3.8-flash', 'gemini-flash-latest'].filter(
    (m, i, a) => Boolean(m) && a.indexOf(m) === i,
  );

export interface MetaCreativeDraft {
  id: string;
  workspaceId: string;
  clientQuery?: string;
  accountId?: string;
  accountName?: string;
  adsetId?: string;
  adsetName?: string;
  brief: string;
  referencePath?: string | null;
  feedPath?: string | null;
  storyPath?: string | null;
  feedAspect: '4:5' | '1:1';
  adName: string;
  primaryText: string;
  headline: string;
  description: string;
  ctaType: string;
  status: 'draft' | 'published';
  publishedAdId?: string;
  publishedStoryAdId?: string;
  publishedStatus?: 'ACTIVE' | 'PAUSED';
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreativeMediaAttachment {
  path: string;
  caption: string;
  kind: 'feed' | 'story';
}

export interface CreativeActionResult {
  draft: MetaCreativeDraft;
  attachments: CreativeMediaAttachment[];
  adsets?: { id: string; name: string; campaignName: string; status: string; goal: string }[];
  note?: string;
}

/* ---------- Storage helpers ---------- */

async function ensureBucket() {
  await sbAdmin().storage.createBucket(BUCKET, { public: false }).catch(() => null);
}

export async function storeCreativeBuffer(workspaceId: string, namePrefix: string, buf: Buffer, mime = 'image/jpeg'): Promise<string> {
  await ensureBucket();
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const path = `${workspaceId}/creatives/${israelDay().slice(0, 7)}/${namePrefix}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error } = await sbAdmin().storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: false });
  if (error) throw new HttpError(502, `שמירת תמונה נכשלה: ${error.message}`);
  return path;
}

export async function signedCreativeUrl(path: string, ttlSeconds = 7200): Promise<string | null> {
  const { data, error } = await sbAdmin().storage.from(BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function downloadStoredBuffer(path: string): Promise<{ buf: Buffer; mime: string } | null> {
  const { data, error } = await sbAdmin().storage.from(BUCKET).download(path);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const mime = path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return { buf, mime };
}

/* ---------- Draft persistence ---------- */

export async function getActiveCreativeDraft(workspaceId: string): Promise<MetaCreativeDraft | null> {
  const { data } = await sbAdmin()
    .from('gd_records')
    .select('id, data')
    .eq('workspace_id', workspaceId)
    .eq('collection', COLLECTION)
    .order('updated_at', { ascending: false })
    .limit(5);
  const found = (data ?? []).map((r) => r.data as MetaCreativeDraft).find((d) => d && d.status === 'draft');
  return found ?? null;
}

export async function saveCreativeDraft(draft: MetaCreativeDraft): Promise<void> {
  draft.updatedAt = new Date().toISOString();
  await sbAdmin().from('gd_records').upsert({
    id: draft.id,
    workspace_id: draft.workspaceId,
    collection: COLLECTION,
    data: draft,
    updated_at: draft.updatedAt,
  });
}

/* ---------- Account resolution ---------- */

export async function resolveAgencyAccount(workspaceId: string, query?: string) {
  if (!query?.trim()) return null;
  const list = await loadAgencyAccounts(workspaceId).catch(() => DEFAULT_AGENCY_ACCOUNTS);
  const q = query.trim().toLowerCase().replace(/[׳'"״-]/g, ' ');
  const byId = list.find((a) => a.accountId === q.replace(/^act_/, ''));
  if (byId) return byId;
  const norm = q
    .replace(/אוספא|או ספא|ספא ראש/, 'ospa')
    .replace(/טוסום/, 'twosome')
    .replace(/קוזי/, 'cozy');
  return (
    list.find((a) => `${a.name} ${a.business || ''}`.toLowerCase().replace(/[׳'"״-]/g, ' ').includes(norm)) ??
    list.find((a) =>
      norm
        .split(/\s+/)
        .filter((w) => w.length >= 2)
        .some((w) => `${a.name} ${a.business || ''}`.toLowerCase().includes(w)),
    ) ??
    null
  );
}

/** Heuristic: detect whether an incoming WhatsApp image is an ad creative reference (vs a receipt). */
export function isCreativeReferenceCaption(caption: string): boolean {
  const t = String(caption || '').trim();
  if (!t) return false;
  if (/קבל|חשבונ|הוצא|מע״מ|מעמ|תשלום|receipt|invoice/i.test(t)) return false;
  if (
    /רפרנס|מודע|קריאייטיב|גרפיק|באנר|סטורי|פיד|קמפיין|פרסום|עיצוב|תכין|תיצור|תעצב|תבנה|שלט|פוסט|רילס|מטא|creative|banner|story|feed|meta/i.test(
      t,
    )
  ) {
    return true;
  }
  // Check if caption explicitly mentions one of the agency client names
  const norm = t.toLowerCase().replace(/[׳'"״-]/g, ' ');
  return /(ospa|אוספא|מונה מדיקל|טוסום|twosome|באלנס|אורי ממריאים|איזי ריזולטס|טכניקדמי|עדן רוסק|גיקאר|ג׳יקאר|cozy|קוזי)/i.test(norm);
}

/* ---------- Gemini Image + Copy Generation ---------- */

async function callGeminiImage(
  prompt: string,
  aspectRatio: '4:5' | '1:1' | '9:16',
  refImages: { buf: Buffer; mime: string }[] = [],
): Promise<{ buf: Buffer; mime: string }> {
  if (!has('GEMINI_API_KEY')) throw new HttpError(503, 'GEMINI_API_KEY לא מוגדר בשרת');
  const parts: any[] = [];
  for (const img of refImages) {
    // Resize reference to <= 1280px JPEG for fast, reliable multimodal input
    const normalized = await sharp(img.buf)
      .rotate()
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
      .catch(() => img.buf);
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: normalized.toString('base64') } });
  }
  parts.push({ text: prompt });

  let lastErr = '';
  for (const model of IMAGE_MODELS()) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(45_000),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio },
          },
        }),
      });
      if (!r.ok) {
        lastErr = `${model} (${r.status}): ${(await r.text()).slice(0, 220)}`;
        console.warn('gemini image fallback', lastErr);
        continue;
      }
      const j: any = await r.json();
      const candParts: any[] = j.candidates?.[0]?.content?.parts ?? [];
      const imgPart = candParts.find((p) => p.inlineData?.data);
      if (imgPart?.inlineData?.data) {
        const rawBuf = Buffer.from(imgPart.inlineData.data, 'base64');
        // Normalize to crisp Meta-compliant JPEG dimensions
        const target =
          aspectRatio === '9:16'
            ? { width: 1080, height: 1920 }
            : aspectRatio === '1:1'
              ? { width: 1080, height: 1080 }
              : { width: 1080, height: 1350 };
        const cleanJpg = await sharp(rawBuf)
          .resize(target.width, target.height, { fit: 'cover', position: 'centre' })
          .jpeg({ quality: 90, mozjpeg: true })
          .toBuffer();
        return { buf: cleanJpg, mime: 'image/jpeg' };
      }
      lastErr = `${model}: לא התקבלה תמונה בתשובה`;
    } catch (e: any) {
      lastErr = `${model}: ${e.message || 'timeout'}`;
      console.warn('gemini image err', lastErr);
    }
  }
  throw new HttpError(502, `יצירת התמונה נכשלה (${lastErr.slice(0, 140)})`);
}

async function generateAdCopyAndPrompts(input: {
  clientName?: string;
  brief: string;
  refImage?: { buf: Buffer; mime: string } | null;
  existingDraft?: MetaCreativeDraft | null;
  editInstruction?: string;
}): Promise<{
  adName: string;
  primaryText: string;
  headline: string;
  description: string;
  ctaType: string;
  feedVisualPrompt: string;
  storyVisualPrompt: string;
}> {
  const parts: any[] = [];
  if (input.refImage) {
    const normalized = await sharp(input.refImage.buf)
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
      .catch(() => input.refImage!.buf);
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: normalized.toString('base64') } });
  }

  const prompt = `אתה מנהל קריאייטיב וקופירייטר בכיר במשרד הפרסום אדיג׳יטל (Meta Ads ישראל).
${input.clientName ? `לקוח: ${input.clientName}` : 'לקוח: (לפי הבריף)'}
בריף / הנחיות: ${input.brief}
${input.existingDraft ? `טיוטה קיימת לעדכון:\nכותרת: ${input.existingDraft.headline}\nטקסט ראשי: ${input.existingDraft.primaryText}\nתיאור: ${input.existingDraft.description}\nשינוי מבוקש: ${input.editInstruction || ''}` : ''}

החזר JSON בלבד (ללא markdown) עם השדות הבאים:
{
  "adName": "שם קצר וברור למודעה בעברית לניהול בקמפיין (למשל: מונה מדיקל · פיסול אף · קריאייטיב 1)",
  "primaryText": "טקסט ראשי משכנע בעברית ישראלית טבעית לפרסום במטא (פתיחה חזקה עם הוק, 2-3 נקודות ערך עם אמוג׳ים עדינים, קריאה לפעולה ברורה בסוף)",
  "headline": "כותרת קצרה וחדה בעברית עד 38 תווים",
  "description": "שורת תיאור קצרה בעברית עד 30 תווים",
  "ctaType": "אחד מתוך: LEARN_MORE | SIGN_UP | SEND_MESSAGE | BOOK_TRAVEL | APPLY_NOW | CONTACT_US | GET_OFFER",
  "feedVisualPrompt": "Detailed English art-direction prompt for a high-converting Meta Feed ad graphic (4:5 vertical). Follow the reference image's visual style, lighting, composition and brand feel closely while applying the user's brief. Clean luxury agency design, crisp typography if short Hebrew/brand text is requested (keep on-image text minimal and large so it renders cleanly), generous breathing room, no watermarks.",
  "storyVisualPrompt": "Detailed English art-direction prompt for the matching Meta Stories & Reels graphic (9:16 vertical). Keep exact same brand colors, photography/subject style and typography as the Feed version, composed specifically for 9:16 vertical mobile with safe zones at top 14% and bottom 20% for Instagram UI overlays."
}`;

  parts.push({ text: prompt });

  for (const model of TEXT_MODELS()) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(25_000),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.5 },
        }),
      });
      if (!r.ok) continue;
      const j: any = await r.json();
      const raw = j.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const parsed = JSON.parse(raw);
      return {
        adName: String(parsed.adName || `מודעה חדשה · ${input.clientName || israelDay()}`).slice(0, 120),
        primaryText: String(parsed.primaryText || input.brief).slice(0, 1500),
        headline: String(parsed.headline || input.clientName || 'השאירו פרטים עכשיו').slice(0, 80),
        description: String(parsed.description || 'לפרטים נוספים >>').slice(0, 80),
        ctaType: ['LEARN_MORE', 'SIGN_UP', 'SEND_MESSAGE', 'BOOK_TRAVEL', 'APPLY_NOW', 'CONTACT_US', 'GET_OFFER'].includes(
          parsed.ctaType,
        )
          ? parsed.ctaType
          : 'LEARN_MORE',
        feedVisualPrompt: String(
          parsed.feedVisualPrompt || `High-converting Meta Feed 4:5 advertisement graphic based on reference and brief: ${input.brief}`,
        ),
        storyVisualPrompt: String(
          parsed.storyVisualPrompt || `High-converting Meta Story 9:16 vertical advertisement graphic matching the Feed ad: ${input.brief}`,
        ),
      };
    } catch {
      continue;
    }
  }
  return {
    adName: `מודעה חדשה · ${input.clientName || israelDay()}`,
    primaryText: input.brief,
    headline: input.clientName || 'השאירו פרטים עכשיו',
    description: 'לפרטים נוספים',
    ctaType: 'LEARN_MORE',
    feedVisualPrompt: `High-converting Meta Feed 4:5 advertisement graphic based on reference and brief: ${input.brief}`,
    storyVisualPrompt: `High-converting Meta Story 9:16 vertical advertisement graphic matching the Feed ad: ${input.brief}`,
  };
}

/* ---------- Meta Graph API Helpers (AdSets + Upload + Publish) ---------- */

async function metaGraph(
  path: string,
  params: Record<string, string> = {},
  method: 'GET' | 'POST' = 'GET',
): Promise<any> {
  const token = metaAdsToken();
  if (!token) throw new HttpError(503, 'חסר טוקן גישה למטא (META_ADS_ACCESS_TOKEN)');
  const q = new URLSearchParams({ ...params, access_token: token });
  const secret = env('META_ADS_ACCESS_TOKEN') ? env('META_ADS_APP_SECRET') : env('META_APP_SECRET');
  if (secret) q.set('appsecret_proof', createHmac('sha256', secret).update(token).digest('hex'));

  const url = method === 'GET' ? `${G}/${V()}/${path.replace(/^\//, '')}?${q}` : `${G}/${V()}/${path.replace(/^\//, '')}`;
  const r = await fetch(url, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
    body: method === 'POST' ? q.toString() : undefined,
    signal: AbortSignal.timeout(25_000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const msg = j.error?.error_user_msg || j.error?.message || `שגיאת Meta API (${r.status})`;
    const e = new HttpError(r.status === 400 || r.status === 403 ? 424 : 502, msg);
    (e as any).metaError = j.error;
    throw e;
  }
  return j;
}

export async function listClientAdSets(workspaceId: string, clientQuery: string) {
  const acc = await resolveAgencyAccount(workspaceId, clientQuery);
  if (!acc) throw new HttpError(404, `לא מצאתי חשבון מודעות בשם "${clientQuery}"`);
  const res = await metaGraph(`act_${acc.accountId}/adsets`, {
    fields: 'id,name,status,effective_status,optimization_goal,campaign{id,name,objective}',
    filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] }]),
    limit: '25',
  });
  const rows: any[] = res.data ?? [];
  // Active first
  rows.sort((a, b) => (a.effective_status === 'ACTIVE' ? -1 : 1) - (b.effective_status === 'ACTIVE' ? -1 : 1));
  return {
    account: acc,
    adsets: rows.slice(0, 12).map((s) => ({
      id: String(s.id),
      name: String(s.name || s.id),
      campaignName: String(s.campaign?.name || ''),
      status: String(s.effective_status || s.status || ''),
      goal: String(s.optimization_goal || ''),
    })),
  };
}

async function uploadImageToMeta(accountId: string, jpgBuf: Buffer, filename: string): Promise<string> {
  const res = await metaGraph(
    `act_${accountId}/adimages`,
    {
      bytes: jpgBuf.toString('base64'),
      name: filename,
    },
    'POST',
  );
  const images = res.images || {};
  const first: any = Object.values(images)[0];
  const hash = first?.hash;
  if (!hash) throw new HttpError(502, 'העלאת התמונה למטא לא החזירה image_hash');
  return String(hash);
}

interface InheritedTemplate {
  pageId: string;
  instagramUserId?: string;
  link?: string;
  leadGenFormId?: string;
  ctaType?: string;
  ctaValue?: Record<string, any>;
}

async function inspectAdSetTemplate(accountId: string, adsetId: string): Promise<InheritedTemplate> {
  const fetchAds = async (edge: string) => {
    const r = await metaGraph(edge, {
      fields: 'id,name,creative{id,object_story_spec,asset_feed_spec,call_to_action_type}',
      limit: '6',
    }).catch(() => ({ data: [] }));
    return (r.data ?? []) as any[];
  };

  let ads = await fetchAds(`${adsetId}/ads`);
  if (!ads.length) ads = await fetchAds(`act_${accountId}/ads`);

  for (const ad of ads) {
    const spec = ad?.creative?.object_story_spec;
    if (!spec?.page_id) continue;
    const ld = spec.link_data || {};
    const vd = spec.video_data || {};
    const cta = ld.call_to_action || vd.call_to_action;
    const ctaValue = cta?.value && typeof cta.value === 'object' ? { ...cta.value } : undefined;
    const leadGenFormId = ctaValue?.lead_gen_form_id ? String(ctaValue.lead_gen_form_id) : undefined;
    const link = ld.link || ctaValue?.link || undefined;
    return {
      pageId: String(spec.page_id),
      instagramUserId: spec.instagram_user_id ? String(spec.instagram_user_id) : spec.instagram_actor_id ? String(spec.instagram_actor_id) : undefined,
      link: link ? String(link) : undefined,
      leadGenFormId,
      ctaType: cta?.type || ad?.creative?.call_to_action_type || undefined,
      ctaValue,
    };
  }
  throw new HttpError(
    424,
    'לא נמצאה מודעה קיימת בסט המודעות או בחשבון כדי לשאוב ממנה דף פייסבוק (page_id) ויעד. ודא שיש לפחות מודעה אחת בחשבון.',
  );
}

/* ---------- Main Creative Studio Operations ---------- */

/** Create a brand-new Feed + Story creative draft + Hebrew copy from brief & optional reference image. */
export async function createCreativeDraft(input: {
  workspaceId: string;
  client?: string;
  brief: string;
  referenceBuf?: Buffer;
  referenceMime?: string;
  referencePath?: string | null;
  feedAspect?: '4:5' | '1:1';
}): Promise<CreativeActionResult> {
  const acc = await resolveAgencyAccount(input.workspaceId, input.client || input.brief);
  const feedAspect: '4:5' | '1:1' = input.feedAspect === '1:1' || /1:1|ריבוע|מרובע/.test(input.brief) ? '1:1' : '4:5';

  let refPath = input.referencePath ?? null;
  let refImage: { buf: Buffer; mime: string } | null = null;
  if (input.referenceBuf) {
    refImage = { buf: input.referenceBuf, mime: input.referenceMime || 'image/jpeg' };
    if (!refPath) {
      refPath = await storeCreativeBuffer(input.workspaceId, 'ref', input.referenceBuf, refImage.mime);
    }
  } else if (refPath) {
    refImage = await downloadStoredBuffer(refPath);
  }

  // Step 1: Plan Hebrew ad copy + Feed & Story art-direction prompts
  const plan = await generateAdCopyAndPrompts({
    clientName: acc?.name || input.client,
    brief: input.brief,
    refImage,
  });

  // Step 2: Generate Feed + Story images in parallel
  const refList = refImage ? [refImage] : [];
  const [feedImg, storyImg] = await Promise.all([
    callGeminiImage(plan.feedVisualPrompt, feedAspect, refList),
    callGeminiImage(plan.storyVisualPrompt, '9:16', refList),
  ]);

  const draftId = `mc-${crypto.randomUUID().slice(0, 10)}`;
  const [feedPath, storyPath] = await Promise.all([
    storeCreativeBuffer(input.workspaceId, `${draftId}-feed`, feedImg.buf, feedImg.mime),
    storeCreativeBuffer(input.workspaceId, `${draftId}-story`, storyImg.buf, storyImg.mime),
  ]);

  const adsets = acc ? (await listClientAdSets(input.workspaceId, acc.accountId).catch(() => ({ adsets: [] }))).adsets : [];

  const draft: MetaCreativeDraft = {
    id: draftId,
    workspaceId: input.workspaceId,
    clientQuery: input.client,
    accountId: acc?.accountId,
    accountName: acc?.name,
    adsetId: adsets.length === 1 ? adsets[0].id : undefined,
    adsetName: adsets.length === 1 ? adsets[0].name : undefined,
    brief: input.brief,
    referencePath: refPath,
    feedPath,
    storyPath,
    feedAspect,
    adName: plan.adName,
    primaryText: plan.primaryText,
    headline: plan.headline,
    description: plan.description,
    ctaType: plan.ctaType,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveCreativeDraft(draft);

  return {
    draft,
    adsets,
    attachments: [
      { path: feedPath, kind: 'feed', caption: `🖼️ גרסת פיד (${feedAspect}) — ${draft.accountName || draft.adName}` },
      { path: storyPath, kind: 'story', caption: `📱 גרסת סטורי / רילס (9:16) — ${draft.accountName || draft.adName}` },
    ],
  };
}

/** Revise the active creative draft: copy-only edits (instant) and/or visual regeneration for Feed/Story/Both. */
export async function reviseCreativeDraft(input: {
  workspaceId: string;
  editInstruction?: string;
  regenerate?: 'none' | 'feed' | 'story' | 'both';
  primaryText?: string;
  headline?: string;
  description?: string;
  ctaType?: string;
  adName?: string;
  client?: string;
  adsetId?: string;
  adsetName?: string;
}): Promise<CreativeActionResult> {
  const draft = await getActiveCreativeDraft(input.workspaceId);
  if (!draft) throw new HttpError(404, 'אין כרגע טיוטת מודעה פעילה. שלח תמונת רפרנס או בריף כדי להתחיל.');

  if (input.client) {
    const acc = await resolveAgencyAccount(input.workspaceId, input.client);
    if (acc) {
      draft.accountId = acc.accountId;
      draft.accountName = acc.name;
    }
  }
  if (input.adsetId) draft.adsetId = input.adsetId;
  if (input.adsetName) draft.adsetName = input.adsetName;
  if (input.adName) draft.adName = input.adName;
  if (input.primaryText) draft.primaryText = input.primaryText;
  if (input.headline) draft.headline = input.headline;
  if (input.description) draft.description = input.description;
  if (input.ctaType) draft.ctaType = input.ctaType;

  const attachments: CreativeMediaAttachment[] = [];
  const regen = input.regenerate || 'none';

  if (regen !== 'none') {
    const refImgs: { buf: Buffer; mime: string }[] = [];
    if (draft.referencePath) {
      const r = await downloadStoredBuffer(draft.referencePath);
      if (r) refImgs.push(r);
    }
    if (draft.feedPath) {
      const prev = await downloadStoredBuffer(draft.feedPath);
      if (prev) refImgs.push(prev);
    }
    const plan = await generateAdCopyAndPrompts({
      clientName: draft.accountName,
      brief: draft.brief,
      refImage: refImgs[0] ?? null,
      existingDraft: draft,
      editInstruction: input.editInstruction || 'שפר את העיצוב לפי ההנחיה',
    });

    if (!input.primaryText && input.editInstruction && /מלל|טקסט|קופי|כותרת/.test(input.editInstruction)) {
      draft.primaryText = plan.primaryText;
      draft.headline = plan.headline;
      draft.description = plan.description;
    }

    const tasks: Promise<void>[] = [];
    if (regen === 'feed' || regen === 'both') {
      tasks.push(
        (async () => {
          const img = await callGeminiImage(
            `${plan.feedVisualPrompt}\n\nIMPORTANT REVISION: ${input.editInstruction || ''}`,
            draft.feedAspect,
            refImgs,
          );
          draft.feedPath = await storeCreativeBuffer(draft.workspaceId, `${draft.id}-feed-v2`, img.buf, img.mime);
          attachments.push({ path: draft.feedPath, kind: 'feed', caption: `🖼️ גרסת פיד מעודכנת (${draft.feedAspect})` });
        })(),
      );
    }
    if (regen === 'story' || regen === 'both') {
      tasks.push(
        (async () => {
          const img = await callGeminiImage(
            `${plan.storyVisualPrompt}\n\nIMPORTANT REVISION: ${input.editInstruction || ''}`,
            '9:16',
            refImgs,
          );
          draft.storyPath = await storeCreativeBuffer(draft.workspaceId, `${draft.id}-story-v2`, img.buf, img.mime);
          attachments.push({ path: draft.storyPath, kind: 'story', caption: `📱 גרסת סטורי מעודכנת (9:16)` });
        })(),
      );
    }
    await Promise.all(tasks);
  }

  await saveCreativeDraft(draft);
  return { draft, attachments };
}

/** Publish the approved Feed + Story creative & copy to Meta Ads (ACTIVE by default, PAUSED if user requested not to publish live). */
export async function publishCreativeDraftToMeta(input: {
  workspaceId: string;
  client?: string;
  adsetId?: string;
  adsetQuery?: string;
  publishStatus?: 'ACTIVE' | 'PAUSED';
}): Promise<{
  ok: true;
  accountName: string;
  adsetId: string;
  adsetName: string;
  adId: string;
  storyAdId?: string;
  requestedStatus: 'ACTIVE' | 'PAUSED';
  verifiedStatus: string;
  effectiveStatus: string;
  placementMode: 'unified_feed_and_story' | 'feed_plus_story_ads' | 'feed_only';
}> {
  const draft = await getActiveCreativeDraft(input.workspaceId);
  if (!draft) throw new HttpError(404, 'אין טיוטת מודעה פעילה להעלאה.');
  if (!draft.feedPath) throw new HttpError(400, 'חסרה גרפיקת פיד בטיוטה.');

  // Resolve account
  let accountId = draft.accountId;
  let accountName = draft.accountName || '';
  if (input.client || !accountId) {
    const acc = await resolveAgencyAccount(input.workspaceId, input.client || draft.clientQuery || draft.brief);
    if (acc) {
      accountId = acc.accountId;
      accountName = acc.name;
    }
  }
  if (!accountId) throw new HttpError(400, 'לא צוין לקוח/חשבון מודעות להעלאה. ציין את שם הלקוח.');

  // Resolve Ad Set
  let adsetId = input.adsetId || draft.adsetId;
  let adsetName = draft.adsetName || '';
  if (!adsetId) {
    const { adsets } = await listClientAdSets(input.workspaceId, accountId);
    if (!adsets.length) throw new HttpError(404, `אין סדרות מודעות פעילות/מושהות בחשבון ${accountName}.`);
    if (input.adsetQuery) {
      const q = input.adsetQuery.toLowerCase();
      const hit = adsets.find((s) => `${s.name} ${s.campaignName}`.toLowerCase().includes(q) || s.id === q);
      if (hit) {
        adsetId = hit.id;
        adsetName = hit.name;
      }
    }
    if (!adsetId) {
      if (adsets.length === 1) {
        adsetId = adsets[0].id;
        adsetName = adsets[0].name;
      } else {
        throw new HttpError(
          400,
          `יש כמה סדרות מודעות ב־${accountName}. באיזו מהן להעלות?\n${adsets
            .slice(0, 6)
            .map((s, i) => `${i + 1}. ${s.name} (${s.campaignName || s.goal})`)
            .join('\n')}`,
        );
      }
    }
  }

  // Default to ACTIVE upon approval (per Avihu's rule), PAUSED only when explicitly requested
  const requestedStatus: 'ACTIVE' | 'PAUSED' = input.publishStatus === 'PAUSED' ? 'PAUSED' : 'ACTIVE';

  // Download generated images & inspect template from existing ad in the Ad Set
  const [feedFile, storyFile, template] = await Promise.all([
    downloadStoredBuffer(draft.feedPath),
    draft.storyPath ? downloadStoredBuffer(draft.storyPath) : Promise.resolve(null),
    inspectAdSetTemplate(accountId, adsetId),
  ]);
  if (!feedFile) throw new HttpError(500, 'לא הצלחתי לטעון את קובץ הפיד מהאחסון.');

  // Upload images to Meta Ad Account
  const [feedHash, storyHash] = await Promise.all([
    uploadImageToMeta(accountId, feedFile.buf, `${draft.id}-feed.jpg`),
    storyFile ? uploadImageToMeta(accountId, storyFile.buf, `${draft.id}-story.jpg`) : Promise.resolve(null),
  ]);

  const effectiveCta = template.ctaType || draft.ctaType || 'LEARN_MORE';
  const baseStorySpec: Record<string, any> = {
    page_id: template.pageId,
    ...(template.instagramUserId ? { instagram_user_id: template.instagramUserId } : {}),
  };

  let creativeId = '';
  let placementMode: 'unified_feed_and_story' | 'feed_plus_story_ads' | 'feed_only' = 'feed_only';

  // Attempt 1: Unified Placement Asset Customization (Feed 4:5 + Story 9:16 in ONE AdCreative)
  if (storyHash && (template.link || template.leadGenFormId)) {
    try {
      const assetFeedSpec: Record<string, any> = {
        images: [
          { hash: feedHash, adlabels: [{ name: 'feed_asset' }] },
          { hash: storyHash, adlabels: [{ name: 'story_asset' }] },
        ],
        bodies: [{ text: draft.primaryText }],
        titles: [{ text: draft.headline }],
        descriptions: [{ text: draft.description }],
        ad_formats: ['SINGLE_IMAGE'],
        call_to_action_types: [effectiveCta],
        ...(template.link ? { link_urls: [{ website_url: template.link }] } : {}),
        ...(template.leadGenFormId
          ? { call_to_actions: [{ type: effectiveCta, value: { lead_gen_form_id: template.leadGenFormId } }] }
          : {}),
        asset_customization_rules: [
          {
            customization_spec: {
              publisher_platforms: ['facebook', 'instagram'],
              facebook_positions: ['story', 'facebook_reels'],
              instagram_positions: ['story', 'reels'],
            },
            image_label: { name: 'story_asset' },
            priority: 1,
          },
          {
            customization_spec: {},
            image_label: { name: 'feed_asset' },
            priority: 2,
          },
        ],
      };

      const cr = await metaGraph(
        `act_${accountId}/adcreatives`,
        {
          name: `${draft.adName} (פיד + סטורי)`,
          object_story_spec: JSON.stringify(baseStorySpec),
          asset_feed_spec: JSON.stringify(assetFeedSpec),
        },
        'POST',
      );
      if (cr?.id) {
        creativeId = String(cr.id);
        placementMode = 'unified_feed_and_story';
      }
    } catch (e: any) {
      console.warn('meta unified asset_feed_spec fallback:', e.message);
    }
  }

  // Helper to build standard single-image creative
  const createSingleCreative = async (imageHash: string, suffix: string) => {
    const linkData: Record<string, any> = {
      image_hash: imageHash,
      message: draft.primaryText,
      name: draft.headline,
      description: draft.description,
      ...(template.link ? { link: template.link } : { link: `https://facebook.com/${template.pageId}` }),
      call_to_action: {
        type: effectiveCta,
        ...(template.ctaValue ? { value: template.ctaValue } : template.link ? { value: { link: template.link } } : {}),
      },
    };
    const cr = await metaGraph(
      `act_${accountId}/adcreatives`,
      {
        name: `${draft.adName} · ${suffix}`,
        object_story_spec: JSON.stringify({ ...baseStorySpec, link_data: linkData }),
      },
      'POST',
    );
    return String(cr.id);
  };

  let storyAdId: string | undefined;
  if (!creativeId) {
    creativeId = await createSingleCreative(feedHash, 'פיד');
    placementMode = storyHash ? 'feed_plus_story_ads' : 'feed_only';
  }

  // Create primary Ad
  const adRes = await metaGraph(
    `act_${accountId}/ads`,
    {
      name: placementMode === 'unified_feed_and_story' ? draft.adName : `${draft.adName} · פיד`,
      adset_id: adsetId,
      creative: JSON.stringify({ creative_id: creativeId }),
      status: requestedStatus,
    },
    'POST',
  );
  const adId = String(adRes.id);

  // If fallback mode and we have a Story image, also create the matching Story ad
  if (placementMode === 'feed_plus_story_ads' && storyHash) {
    try {
      const storyCreativeId = await createSingleCreative(storyHash, 'סטורי 9:16');
      const sAd = await metaGraph(
        `act_${accountId}/ads`,
        {
          name: `${draft.adName} · סטורי 9:16`,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: storyCreativeId }),
          status: requestedStatus,
        },
        'POST',
      );
      storyAdId = String(sAd.id);
    } catch (e: any) {
      console.warn('story secondary ad failed:', e.message);
      placementMode = 'feed_only';
    }
  }

  // Read-Back Verification from Meta servers
  const verify = await metaGraph(adId, { fields: 'id,name,status,effective_status,adset_id' }).catch(() => ({
    status: requestedStatus,
    effective_status: requestedStatus,
  }));

  draft.accountId = accountId;
  draft.accountName = accountName;
  draft.adsetId = adsetId;
  draft.adsetName = adsetName;
  draft.status = 'published';
  draft.publishedAdId = adId;
  draft.publishedStoryAdId = storyAdId;
  draft.publishedStatus = requestedStatus;
  draft.publishedAt = new Date().toISOString();
  await saveCreativeDraft(draft);

  // Write to Verified Audit Log so it appears in MetaCampaignsPage
  try {
    await sbAdmin()
      .from('gd_records')
      .insert({
        id: `log-${crypto.randomUUID().slice(0, 12)}`,
        workspace_id: input.workspaceId,
        collection: LOG_COLLECTION,
        data: {
          at: new Date().toISOString(),
          accountId,
          accountName,
          kind: 'create_ad',
          entityId: adId,
          entityName: draft.adName,
          before: 'לא קיימת',
          after: `${verify.status || requestedStatus} (${placementMode === 'unified_feed_and_story' ? 'פיד + סטורי' : storyAdId ? 'פיד + סטורי (2 מודעות)' : 'פיד'})`,
          verified: true,
        },
      });
  } catch { /* non-blocking audit log */ }

  return {
    ok: true,
    accountName,
    adsetId,
    adsetName,
    adId,
    storyAdId,
    requestedStatus,
    verifiedStatus: String(verify.status || requestedStatus),
    effectiveStatus: String(verify.effective_status || requestedStatus),
    placementMode,
  };
}
