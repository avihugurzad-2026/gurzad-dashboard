-- Receipt copies (bucket gd-receipts, path <workspace_id>/<yyyy-mm>/<uuid>.webp) are written by the server (service role).
-- Signed-in members may view them when they can read the WhatsApp log or the home expenses.
create policy gd_receipts_read on storage.objects for select to authenticated using (
  bucket_id = 'gd-receipts' and (
    gd_can_read(((storage.foldername(name))[1])::uuid, 'wa_messages')
    or gd_can_read(((storage.foldername(name))[1])::uuid, 'transactions')
    or gd_can_read(((storage.foldername(name))[1])::uuid, 'biz_expenses')));
