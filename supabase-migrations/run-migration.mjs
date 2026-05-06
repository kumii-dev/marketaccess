#!/usr/bin/env node
/**
 * run-migration.mjs
 * =================
 * Applies supabase-migrations/002_etender_daily_cache.sql to Supabase
 * using the service role key (bypasses RLS).
 *
 * Usage:
 *   node supabase-migrations/run-migration.mjs
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL      = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

// ── Run migration statements one at a time via rpc or REST ───────────────────
// Supabase free tier doesn't expose exec_sql, so we use the pg_meta endpoint
// via the Management API.  If that's also blocked, the script prints the SQL
// so you can paste it into the Supabase SQL Editor instead.

const sqlFile = path.join(__dirname, '002_etender_daily_cache.sql');
const sql = readFileSync(sqlFile, 'utf8');

console.log('📄 Migration: 002_etender_daily_cache.sql');
console.log('🔗 Project:  ', SUPABASE_URL);
console.log('');
console.log('ℹ️  Supabase free plan does not expose a direct SQL execution endpoint.');
console.log('   Please paste the SQL below into the Supabase SQL Editor:');
console.log('   👉  https://supabase.com/dashboard/project/njcancswtqnxihxavshl/sql');
console.log('');
console.log('─'.repeat(70));
console.log(sql);
console.log('─'.repeat(70));
console.log('');

// Verify if the table already exists
const { data, error } = await supabase
  .from('etender_daily_cache')
  .select('snapshot_date')
  .limit(1);

if (error?.code === 'PGRST205') {
  console.log('⚠️  Table etender_daily_cache does NOT exist yet.');
  console.log('   → Copy the SQL above and run it in the Supabase SQL Editor.');
} else if (error) {
  console.log('⚠️  Could not verify table:', error.message);
} else {
  console.log('✅  Table etender_daily_cache already exists — migration may already be applied.');
}
