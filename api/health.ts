import { handler, has, env } from './_lib/server.js';

// Reports WHICH integrations are configured — never the values.
export default handler(async (_req, res) => {
  res.json({
    supabase: has('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'),
    mail: has('RESEND_API_KEY', 'MAIL_FROM'),
    owner: has('OWNER_EMAIL'),
    push: has('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'),
    cron: has('CRON_SECRET'),
    gemini: has('GEMINI_API_KEY'),
    kapso: has('KAPSO_API_KEY', 'KAPSO_PHONE_NUMBER_ID'),
    kapso_webhook: has('KAPSO_WEBHOOK_SECRET') || has('SUPABASE_SERVICE_ROLE_KEY'),
    allowed_numbers: env('WHATSAPP_ALLOWED_NUMBERS').split(',').filter(Boolean).length,
  });
});
