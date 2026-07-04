import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(path.join(__dirname, '../.env'), 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && !k.startsWith('#') && rest.length) process.env[k.trim()] = rest.join('=').trim();
}

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Province distribution in DB province column
const { data, error } = await admin.from('active_tenders').select('province');
if (error) { console.error(error.message); process.exit(1); }

const byProv = {};
let nullCount = 0;
for (const row of data) {
  if (row.province) byProv[row.province] = (byProv[row.province] || 0) + 1;
  else nullCount++;
}
console.log('Province column distribution (' + data.length + ' total rows):');
Object.entries(byProv).sort((a,b) => b[1]-a[1]).forEach(([p,n]) =>
  console.log('  ' + p.padEnd(20) + n)
);
console.log('  (null)'.padEnd(22) + nullCount);

// How many releases have tender.province set in the JSONB?
const { data: all } = await admin.from('active_tenders').select('release');
let hasRelProv = 0, noRelProv = 0;
for (const row of (all || [])) {
  if (row.release?.tender?.province) hasRelProv++;
  else noRelProv++;
}
console.log('\nrelease.tender.province in JSONB:');
console.log('  set:', hasRelProv, '| null:', noRelProv);
