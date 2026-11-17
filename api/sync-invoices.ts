import { handler, HttpError, requireMember } from './_lib/server.js';

// Placeholder for the per-business invoice provider sync (the provider is not chosen yet).
// Contract for a provider adapter:
//   list(since: string): Promise<{ number, client, amount_net, issue_date, due_date, status, allocation_number }[]>
// The sync upserts into records(collection='invoices') with id `inv-<provider>-<number>` and data.source = provider,
// so manual invoices and synced invoices live side by side.
export default handler(async (req) => {
  await requireMember(req);
  throw new HttpError(501, 'עדיין לא חובר ספק חשבוניות');
});
