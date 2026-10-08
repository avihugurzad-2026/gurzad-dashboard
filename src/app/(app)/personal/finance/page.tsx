import { redirect } from 'next/navigation';

// Personal finance lives at /personal/money; the household book at /household/finance
export default async function PersonalFinanceMoved() {
  redirect('/personal/money');
}
