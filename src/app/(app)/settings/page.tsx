import Link from 'next/link';
import { Soon } from '@/components/dash/soon';

export const metadata = { title: 'הגדרות — דשבורד גורזד' };

export default function SettingsPage() {
  return <Soon title="הגדרות" lead="חלק מההגדרות עוד מנוהל בוואלט ובמשתני הסביבה."
    items={['עסקים ופרויקטים', 'קטגוריות ואמצעי תשלום', 'חיבורים ל-Google', 'התראות וספים', 'ייבוא וייצוא נתונים']}
    note="מע״מ, ספים ובעלים מוגדרים כרגע בקובץ thresholds.md בוואלט, ואפשר לראות אותם בעמוד שלמות נתונים." />;
}
