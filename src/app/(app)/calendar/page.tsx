import { Soon } from '@/components/dash/soon';

export const metadata = { title: 'יומן — דשבורד גורזד' };

export default function CalendarPage() {
  return <Soon title="יומן" lead="בשלב E של התוכנית."
    items={['תצוגות יום, שבוע, חודש וסדר יום', 'סנכרון דו-כיווני עם Google Calendar', 'זיהוי חפיפות בין פגישות', 'גרירת משימה ליומן כחסימת זמן']}
    note="היומן ינוהל בבסיס הנתונים, ו-Google Calendar יהיה מסונכרן אליו." />;
}
