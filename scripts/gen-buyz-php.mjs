// Generates dashboard_ops.php for the Buyz server from the same named queries the dashboard uses.
// Run: node --experimental-strip-types scripts/gen-buyz-php.mjs > dashboard_ops.php
import { BUYZ_SQL } from '../api/_lib/integrations/buyzSql.ts';

const php = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const queries = Object.entries(BUYZ_SQL).map(([k, v]) => `    ${php(k)} => ${php(v.replace(/\s+/g, ' ').trim())},`).join('\n');

process.stdout.write(`<?php
/**
 * dashboard_ops.php - read-only data for the Gurzad dashboard (generated, do not edit the queries by hand).
 *
 * Runs a fixed list of SELECT queries (below) against the local Buyz database and returns rows as JSON.
 * Nothing else can be run: the caller only picks a query name and its parameters.
 *
 * Setup (2 minutes):
 *   1. Upload to https://buyz.co.il/api/dashboard_ops.php
 *   2. Fill the 5 settings below. DASHBOARD_KEY: a long random string (e.g. bin2hex(random_bytes(24))).
 *      Use the read-only database user, host localhost.
 *   3. Give the DASHBOARD_KEY to Avihu; he pastes it in the dashboard (Settings, "Buyz · נתוני תפעול").
 */

const DASHBOARD_KEY = '';          // required, at least 32 chars
const DB_HOST = 'localhost';
const DB_NAME = '';           // the Buyz database name
const DB_USER = '';           // the read-only user
const DB_PASS = '';
// Businesses the key may read, by suppliers.slug. Branches in the same network are allowed automatically.
const ALLOWED_SLUGS = ['ospa'];

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
function out($code, $data) { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }

$key = $_SERVER['HTTP_X_API_KEY'] ?? '';
if (strlen(DASHBOARD_KEY) < 32 || !hash_equals(DASHBOARD_KEY, $key)) out(401, ['ok' => false, 'error' => 'unauthorized']);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') out(405, ['ok' => false, 'error' => 'POST only']);

$Q = [
${queries}
];

$in = json_decode(file_get_contents('php://input'), true) ?: [];
$name = (string)($in['q'] ?? '');
$params = array_values(is_array($in['p'] ?? null) ? $in['p'] : []);
if (!isset($Q[$name])) out(400, ['ok' => false, 'error' => 'unknown query']);
foreach ($params as $p) if (!is_scalar($p) && $p !== null) out(400, ['ok' => false, 'error' => 'bad params']);
if (substr_count($Q[$name], '?') !== count($params)) out(400, ['ok' => false, 'error' => 'param count']);

try {
  $db = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASS, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false,
  ]);

  // Supplier scope: every query except the slug lookup works on a supplier id, which must be an allowed business.
  $allowed = [];
  $st = $db->prepare('SELECT id, network_id FROM suppliers WHERE slug IN (' . implode(',', array_fill(0, count(ALLOWED_SLUGS), '?')) . ')');
  $st->execute(ALLOWED_SLUGS);
  $nets = [];
  foreach ($st->fetchAll() as $r) { $allowed[(int)$r['id']] = true; if ($r['network_id']) $nets[] = $r['network_id']; }
  if ($nets) {
    $st = $db->prepare('SELECT id FROM suppliers WHERE network_id IN (' . implode(',', array_fill(0, count($nets), '?')) . ')');
    $st->execute($nets);
    foreach ($st->fetchAll() as $r) $allowed[(int)$r['id']] = true;
  }
  if ($name === 'supplier') {
    $st = $db->prepare('SELECT id FROM suppliers WHERE slug = ? LIMIT 1'); $st->execute($params); $id = (int)($st->fetchColumn() ?: 0);
    if (!isset($allowed[$id])) out(403, ['ok' => false, 'error' => 'business not allowed']);
  } elseif ($name !== 'ownerBusinesses') {
    // the supplier id is the first int param, except 'bookings' where it is the third
    $sid = (int)($name === 'bookings' ? ($params[2] ?? 0) : ($params[0] ?? 0));
    if (!isset($allowed[$sid])) out(403, ['ok' => false, 'error' => 'business not allowed']);
  }

  $st = $db->prepare($Q[$name]);
  $st->execute($params);
  $rows = $st->fetchAll();
  if ($name === 'ownerBusinesses') {
    $rows = array_map(function ($r) { return array_filter($r, function ($k) { return !preg_match('/key|secret|token|pass|hash|otp|cookie|session/i', $k); }, ARRAY_FILTER_USE_KEY); }, $rows);
  }
  out(200, ['ok' => true, 'rows' => $rows]);
} catch (Throwable $e) {
  error_log('dashboard_ops: ' . $e->getMessage());
  out(500, ['ok' => false, 'error' => 'query failed: ' . $name]);
}
`);
