import { Soon } from '@/components/dash/soon';
import { requireAdmin } from '@/server/auth';

export const metadata = { title: 'דוחות — דשבורד גורזד' };

export default async function ReportsPage() {
  await requireAdmin();
  return <Soon title="דוחות" lead="בשלב F של התוכנית."
    items={['הכנסות, הוצאות, רווח ותזרים', 'דוח מע״מ, ספקים ולקוחות', 'השוואה לתקופה קודמת', 'לחיצה על מספר פותחת את התנועות שמרכיבות אותו', 'ייצוא ל-CSV, Excel ו-PDF']}
    note="הדוחות ייבנו מעל טבלת התנועות, אחרי שלב B." />;
}
