import { env, HttpError } from './server.js';

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

const shell = (inner: string) => `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#ECEDEF;font-family:'Google Sans',Heebo,Arial,sans-serif;color:#17181A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:440px;background:#ffffff;border:1px solid #DCDDE0;border-radius:24px;overflow:hidden" cellpadding="0" cellspacing="0"><tr><td style="padding:32px" dir="rtl" align="right">
<div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(180deg,#5F8A99,#EEF27A);margin-bottom:20px"></div>
${inner}
</td></tr></table></td></tr></table></body></html>`;

export function otpMail(code: string) {
  return {
    subject: `${code} — קוד הכניסה שלך`,
    text: `קוד הכניסה לדשבורד: ${code}\nהקוד תקף ל-10 דקות. אם לא ביקשת קוד, אפשר להתעלם מהמייל.`,
    html: shell(`<h1 style="font-size:22px;font-weight:500;margin:0 0 8px">קוד הכניסה שלך</h1>
<p style="margin:0 0 20px;color:#53555B;font-size:15px">הקלד את הקוד במסך הכניסה. הוא תקף ל־10 דקות.</p>
<div dir="ltr" style="font-size:34px;font-weight:700;letter-spacing:10px;background:#F4F78A;border-radius:16px;padding:18px 0;text-align:center">${esc(code)}</div>
<p style="margin:20px 0 0;color:#74767D;font-size:13px">לא ביקשת קוד? אפשר להתעלם מהמייל הזה.</p>`),
  };
}

export function inviteMail(inviter: string, areas: string[], url: string) {
  const list = areas.map((a) => ({ home: 'ניהול הבית', business: 'ניהול העסקים', invest: 'ניהול ההשקעות' }[a] ?? a)).join(', ');
  return {
    subject: `${inviter} מזמין אותך לדשבורד`,
    text: `${inviter} פתח לך גישה לדשבורד (${list}).\nכניסה: ${url}\nנכנסים עם המייל הזה ומקבלים קוד חד-פעמי. בלי סיסמה.`,
    html: shell(`<h1 style="font-size:22px;font-weight:500;margin:0 0 8px">הוזמנת לדשבורד</h1>
<p style="margin:0 0 6px;color:#53555B;font-size:15px">${esc(inviter)} פתח לך גישה אל: <b>${esc(list)}</b>.</p>
<p style="margin:0 0 24px;color:#53555B;font-size:15px">נכנסים עם כתובת המייל הזו ומקבלים קוד חד־פעמי. בלי סיסמה.</p>
<a href="${esc(url)}" style="display:inline-block;background:#17181A;color:#ffffff;text-decoration:none;border-radius:999px;padding:13px 26px;font-size:15px;font-weight:500">כניסה לדשבורד</a>`),
  };
}

/** A reminder written from the owner's template. Plain text is the source; the HTML keeps its line breaks. */
export function templateMail(subject: string, body: string, opts: { color: string; category: string; url: string }) {
  const html = esc(body).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:#17181A">${u}</a>`).replace(/\n/g, '<br>');
  return {
    subject,
    text: body,
    html: shell(`<div style="display:inline-block;border-radius:999px;padding:4px 12px;font-size:13px;background:${opts.color}22;color:#17181A;border:1px solid ${opts.color}66;margin-bottom:14px">● ${esc(opts.category)}</div>
<h1 style="font-size:20px;font-weight:500;margin:0 0 12px">${esc(subject)}</h1>
<p style="margin:0 0 22px;color:#53555B;font-size:15px;line-height:1.7">${html}</p>
<a href="${esc(opts.url)}" style="display:inline-block;background:#17181A;color:#ffffff;text-decoration:none;border-radius:999px;padding:12px 24px;font-size:15px;font-weight:500">פתיחה ביומן</a>`),
  };
}
