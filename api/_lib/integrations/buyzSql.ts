// Named read-only queries for the Buyz database (see buyzQueries.ts). No imports: scripts/gen-buyz-php.mjs reads this file.
export const BUYZ_SQL = {
  supplier: 'SELECT id, name FROM suppliers WHERE slug = ? LIMIT 1',
  network: `SELECT id, name, slug FROM suppliers
    WHERE network_id = (SELECT network_id FROM suppliers WHERE id = ?) AND network_id IS NOT NULL ORDER BY id`,
  revenueByMonth: `SELECT DATE_FORMAT(d, '%Y-%m') AS m, SUM(amount) AS total FROM (
      SELECT i.created_at AS d, i.amount
      FROM invoices i
      LEFT JOIN bookings b ON b.id = i.booking_id AND b.supplier_id = i.supplier_id
      WHERE i.supplier_id = ? AND i.kind = 'invoice'
        AND NOT EXISTS (SELECT 1 FROM invoices c WHERE c.refund_of = i.id AND c.kind IN ('credit_invoice','credit_receipt'))
        AND COALESCE(b.voucher_id, 0) = 0
        AND i.created_at >= ? AND i.created_at < ?
      UNION ALL
      SELECT COALESCE(updated_at, created_at), amount FROM payments
      WHERE supplier_id = ? AND type = 'booking' AND payment_method = 'external_provider' AND status = 'completed'
        AND COALESCE(updated_at, created_at) >= ? AND COALESCE(updated_at, created_at) < ?
    ) x GROUP BY m ORDER BY m`,
  sold: `SELECT COALESCE(au.display_name, b.created_by_username) AS name, b.created_by_username AS u, COUNT(*) AS n, SUM(b.total_price) AS total
    FROM bookings b LEFT JOIN admin_users au ON au.username = b.created_by_username
    WHERE b.supplier_id = ? AND b.status IN ('confirmed','completed') AND b.created_at >= ? AND b.created_at < ?
    GROUP BY b.created_by_username, au.display_name`,
  treated: `SELECT tm.full_name AS name, tm.portal_username AS u, COUNT(*) AS n, SUM(b.total_price) AS total
    FROM bookings b JOIN team_members tm ON tm.id = b.team_member_id
    WHERE b.supplier_id = ? AND b.status IN ('confirmed','completed') AND b.booking_date >= ? AND b.booking_date < ?
    GROUP BY tm.id, tm.full_name, tm.portal_username`,
  cart: `SELECT tm.full_name AS name, tm.portal_username AS u, COUNT(*) AS n, SUM(o.total_amount) AS total
    FROM staff_cart_orders o JOIN team_members tm ON tm.id = o.team_member_id
    WHERE o.supplier_id = ? AND o.status = 'paid' AND o.created_at >= ? AND o.created_at < ?
    GROUP BY tm.id, tm.full_name, tm.portal_username`,
  hours: `SELECT tm.full_name AS name, tm.portal_username AS u,
      SUM(TIME_TO_SEC(TIMEDIFF(s.end_time, s.start_time)) + IF(s.end_time < s.start_time, 86400, 0)) / 3600 AS h
    FROM team_shifts s JOIN team_members tm ON tm.id = s.team_member_id
    WHERE s.supplier_id = ? AND s.status = 'approved' AND s.shift_date >= ? AND s.shift_date < ?
      AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL
      AND (s.source IN ('punch','manual') OR (s.source IS NULL AND DATE(s.created_at) >= s.shift_date))
    GROUP BY tm.id, tm.full_name, tm.portal_username`,
  fixedExpenses: 'SELECT label, amount, calc_type, rate, is_active FROM supplier_fixed_expenses WHERE supplier_id = ?',
  participants: `SELECT DATE_FORMAT(booking_date, '%Y-%m') AS m, SUM(COALESCE(participant_count, 1)) AS p
    FROM bookings WHERE supplier_id = ? AND status IN ('confirmed','completed') AND booking_date >= ? AND booking_date < ?
    GROUP BY m`,
  bookings: `SELECT status, COUNT(*) AS n, SUM(booking_date = ?) AS today, SUM(booking_date > ?) AS upcoming
    FROM bookings WHERE supplier_id = ? AND booking_date >= ? AND booking_date < ? GROUP BY status`,
  leads: `SELECT COALESCE(ls.label, l.source, 'ללא מקור') AS source, COUNT(*) AS n
    FROM supplier_leads l LEFT JOIN supplier_lead_sources ls ON ls.supplier_id = l.supplier_id AND ls.source_key = l.source
    WHERE l.supplier_id = ? AND l.created_at >= ? AND l.created_at < ? GROUP BY source ORDER BY n DESC`,
  ownerBusinesses: 'SELECT * FROM owner_businesses LIMIT 100',
} as const;
