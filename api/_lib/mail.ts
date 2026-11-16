import { env, HttpError } from './server';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Send through Resend (https://resend.com/docs/api-reference/emails/send-email). */
export async function sendMail(to: string, subject: string, html: string, text: string) {
  if (!env('RESEND_API_KEY') || !env('MAIL_FROM')) throw new HttpError(503, 'שירות המייל לא מוגדר');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env('RESEND_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env('MAIL_FROM'), to: [to], subject, html, text }),
  });
  if (!r.ok) { console.error('Resend failed', r.status, (await r.text()).slice(0, 300)); throw new HttpError(502, 'שליחת המייל נכשלה'); }
}

const shell = (inner: string) => `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#F9FCF8;font-family:'Google Sans',Heebo,Arial,sans-serif;color:#0F3D2E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:440px;background:#ffffff;border:1px solid #DCE8DF;border-radius:24px" cellpadding="0" cellspacing="0"><tr><td style="padding:32px" dir="rtl" align="right">
<div style="width:44px;height:44px;border-radius:14px;background:#0F3D2E;margin-bottom:20px"></div>
${inner}
</td></tr></table></td></tr></table></body></html>`;

export function otpMail(code: string) {
  return {
    subject: `${code} — קוד הכניסה שלך`,
    text: `קוד הכניסה לדשבורד: ${code}\nהקוד תקף ל-10 דקות. אם לא ביקשת קוד, אפשר להתעלם מהמייל.`,
    html: shell(`<h1 style="font-size:22px;font-weight:500;margin:0 0 8px">קוד הכניסה שלך</h1>
<p style="margin:0 0 20px;color:#3D5A4E;font-size:15px">הקלד את הקוד במסך הכניסה. הוא תקף ל־10 דקות.</p>
<div dir="ltr" style="font-size:34px;font-weight:700;letter-spacing:10px;background:#E6F2EA;border-radius:16px;padding:18px 0;text-align:center">${esc(code)}</div>
<p style="margin:20px 0 0;color:#5F786C;font-size:13px">לא ביקשת קוד? אפשר להתעלם מהמייל הזה.</p>`),
  };
}

export function inviteMail(inviter: string, areas: string[], url: string) {
  const list = areas.map((a) => ({ home: 'ניהול הבית', business: 'ניהול העסקים', invest: 'ניהול ההשקעות' }[a] ?? a)).join(', ');
  return {
    subject: `${inviter} מזמין אותך לדשבורד`,
    text: `${inviter} פתח לך גישה לדשבורד (${list}).\nכניסה: ${url}\nנכנסים עם המייל הזה ומקבלים קוד חד-פעמי. בלי סיסמה.`,
    html: shell(`<h1 style="font-size:22px;font-weight:500;margin:0 0 8px">הוזמנת לדשבורד</h1>
<p style="margin:0 0 6px;color:#3D5A4E;font-size:15px">${esc(inviter)} פתח לך גישה אל: <b>${esc(list)}</b>.</p>
<p style="margin:0 0 24px;color:#3D5A4E;font-size:15px">נכנסים עם כתובת המייל הזו ומקבלים קוד חד־פעמי. בלי סיסמה.</p>
<a href="${esc(url)}" style="display:inline-block;background:#0F3D2E;color:#ffffff;text-decoration:none;border-radius:999px;padding:13px 26px;font-size:15px;font-weight:500">כניסה לדשבורד</a>`),
  };
}
