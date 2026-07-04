/**
 * backfill-province.mjs
 * =====================
 * One-shot script to populate the province column for all existing
 * active_tenders rows that were synced before the province-inference fix.
 *
 * Usage: node supabase-migrations/backfill-province.mjs
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
for (const line of readFileSync(path.join(__dirname, '../.env'), 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && !k.startsWith('#') && rest.length) process.env[k.trim()] = rest.join('=').trim();
}

const { inferProvince } = await import(path.join(__dirname, '../server/services/tenderSync.js'));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// 1. Fetch all rows where province is null
console.log('Fetching rows with null province...');
const { data: rows, error: fetchErr } = await admin
  .from('active_tenders')
  .select('ocid, buyer_name')
  .is('province', null);

if (fetchErr) { console.error('❌ Fetch failed:', fetchErr.message); process.exit(1); }
console.log(`Found ${rows.length} row(s) with null province`);

// 2. Group by inferred province
const byProvince = {};
const noProvince = [];
for (const row of rows) {
  const p = inferProvince(row.buyer_name);
  if (p) {
    (byProvince[p] = byProvince[p] || []).push(row.ocid);
  } else {
    noProvince.push(row.ocid);
  }
}

console.log('Province distribution:');
for (const [p, ocids] of Object.entries(byProvince).sort((a,b) => b[1].length - a[1].length)) {
  console.log(`  ${p.padEnd(18)} ${ocids.length}`);
}
console.log(`  (national/none)    ${noProvince.length}`);
console.log('');

// 3. Update each province group in bulk
let totalUpdated = 0;
for (const [province, ocids] of Object.entries(byProvince)) {
  const { error: updErr, count } = await admin
    .from('active_tenders')
    .update({ province })
    .in('ocid', ocids);
  if (updErr) {
    console.warn(`⚠️  Failed to update ${province}:`, updErr.message);
  } else {
    console.log(`✅ Updated ${ocids.length} rows → province = "${province}"`);
    totalUpdated += ocids.length;
  }
}

console.log(`\n✅ Backfill complete — ${totalUpdated} row(s) updated`);
