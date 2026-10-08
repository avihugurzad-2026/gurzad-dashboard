// Shown until the migration that creates the dashboard's own tables has run
export function NotReady({ what }: { what: string }) {
  return (
    <p className="rounded-lg border border-dashed border-line-strong px-3 py-2 text-sm text-muted">
      הזנת {what} תיפתח אחרי יצירת הטבלאות במסד.
    </p>
  );
}
