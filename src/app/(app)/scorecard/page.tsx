import { scorecard } from '@/server/data';
import { requireAdmin } from '@/server/auth';
import { longDate } from '@/lib/format';
import { ScorecardTable } from '@/components/dash/scorecard-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = { title: 'יעדים — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

export default async function ScorecardPage() {
  await requireAdmin();
  const d = await scorecard();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page font-bold">יעדים שבועיים</h1>
        <p className="text-sm text-muted">{longDate(d.today)}. יעד שנקבע ננעל ל-13 שבועות; שינוי לפני כן רק בתכנון רבעוני.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Scorecard</CardTitle>
          <span className="text-sm text-muted">13 שבועות</span>
        </CardHeader>
        <CardContent>
          <ScorecardTable weeks={d.weeks} measures={d.measures} editable />
        </CardContent>
      </Card>
    </div>
  );
}
