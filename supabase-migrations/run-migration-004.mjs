#!/usr/bin/env node
/**
 * run-migration-004.mjs
 * =====================
 * Applies supabase-migrations/004_active_tenders.sql to Supabase.
 *
 * This creates the `active_tenders` table that backs the hourly background
 * tender sync (server/services/tenderSync.js). The table is read-only to
 * anon/authenticated clients and written to exclusively by the server's
 * service_role key, so fetching from the gov API stays decoupled from users.
 *
 * Usage:
 *   node supabase-migrations/run-migration-004.mjs
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

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// Derive the project ref from the URL so the SQL-editor link is always correct.
const projectRef = (SUPABASE_URL.match(/https?:\/\/([^.]+)\./) || [])[1] || 'your-project';

const sqlFile = path.join(__dirname, '004_active_tenders.sql');
const sql = readFileSync(sqlFile, 'utf8');

console.log('📄 Migration: 004_active_tenders.sql');
console.log('🔗 Project:  ', SUPABASE_URL);
console.log('');
console.log('ℹ️  Supabase free plan does not expose a direct SQL execution endpoint.');
console.log('   Please paste the SQL below into the Supabase SQL Editor:');
console.log(`   👉  https://supabase.com/dashboard/project/${projectRef}/sql`);
console.log('');
console.log('─'.repeat(70));
console.log(sql);
console.log('─'.repeat(70));
console.log('');

// Verify whether the table already exists.
const { error } = await supabase
  .from('active_tenders')
  .select('ocid')
  .limit(1);

if (error?.code === 'PGRST205') {
  console.log('⚠️  Table active_tenders does NOT exist yet.');
  console.log('   → Copy the SQL above and run it in the Supabase SQL Editor.');
} else if (error) {
  console.log('⚠️  Could not verify table:', error.message);
} else {
  console.log('✅  Table active_tenders already exists — migration may already be applied.');
}
