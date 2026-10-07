import { redirect } from 'next/navigation';

// Retainers and collections now live on the a-digital page
export default function FinanceRedirect() {
  redirect('/business/adigital?tab=collections');
}
