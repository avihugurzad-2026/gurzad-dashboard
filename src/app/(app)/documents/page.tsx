import { Soon } from '@/components/dash/soon';

export const metadata = { title: 'מסמכים — דשבורד גורזד' };

export default function DocumentsPage() {
  return <Soon title="מסמכים" lead="בשלב C של התוכנית."
    items={['העלאת חשבוניות וקבלות, כולל צילום מהמובייל', 'חסימת קובץ שכבר הועלה לפי חתימת הקובץ', 'זיהוי אותה חשבונית גם כשהקובץ שונה', 'קריאה אוטומטית של ספק, סכום, מע״מ ותאריך', 'אישור שלך לפני שנוצרת תנועה']}
    note="מסמך לא יהפוך לתנועה בלי שתאשר אותו." />;
}
