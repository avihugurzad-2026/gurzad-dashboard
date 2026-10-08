// Row buttons (status, delete, cancel) call a server action directly; a refusal must be visible,
// not look like nothing happened.
export function report(r: unknown) {
  const res = r as { ok?: boolean; error?: string } | null | undefined;
  if (res && res.ok === false) alert(res.error || 'הפעולה לא בוצעה');
}
