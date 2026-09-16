/**
 * Tender Responses Routes
 * ========================
 * Server-authenticated proxy for the `tender_responses` table (users' saved
 * AI-drafted tender responses, shown on the "My Tenders" page).
 *
 * Why this exists:
 *   MyTendersPage.jsx previously queried `tender_responses` directly from the
 *   browser using the anon Supabase client + `supabase.auth.setSession({
 *   access_token, refresh_token: '' })` for iframe-embedded users. Without a
 *   real refresh_token the client SDK session is unreliable, and any request
 *   sent before/without it correctly attached hits RLS as the anon role and
 *   is rejected — the 401 users saw on "My Tenders".
 *
 *   Every other per-user table in this app (email_subscriptions, and now
 *   smart_matched_tenders) is already read/written through a server route
 *   that validates the Bearer JWT itself via the service-role admin client
 *   (see routes/email.js's getUserFromRequest — proven reliable for both
 *   direct-session AND iframe/postMessage-token users). This route applies
 *   the same proven pattern to tender_responses.
 *
 * Endpoints:
 *   GET    /api/tender-responses      — list the caller's saved drafts
 *   DELETE /api/tender-responses/:id  — delete one of the caller's drafts
 *   PUT    /api/tender-responses/:id  — update one of the caller's drafts
 *   POST   /api/tender-responses      — create/upsert a draft
 */

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { generalApiLimiter } from '../middleware/rateLimiters.js';

const router = express.Router();
router.use(generalApiLimiter);

let _admin = null;
function getAdmin() {
  if (_admin) return _admin;
  _admin = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    { auth: { persistSession: false } }
  );
  return _admin;
}

async function getUserFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;
  const { data: { user }, error } = await getAdmin().auth.getUser(token);
  if (error || !user) return null;
  return user;
}

/**
 * GET /api/tender-responses
 * List the authenticated caller's saved drafts, most recently updated first.
 */
router.get('/', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { data, error } = await getAdmin()
    .from('tender_responses')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ results: data || [] });
});

/**
 * POST /api/tender-responses
 * Create or upsert (onConflict user_id,tender_id) a draft for the caller.
 */
router.post('/', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const payload = {
    ...req.body,
    user_id:    user.id,
    user_email: req.body?.user_email || user.email || '',
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await getAdmin()
    .from('tender_responses')
    .upsert(payload, { onConflict: 'user_id,tender_id' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ row: data });
});

/**
 * PUT /api/tender-responses/:id
 * Update an existing draft owned by the caller (by primary key).
 */
router.put('/:id', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  const payload = { ...req.body, updated_at: new Date().toISOString() };
  delete payload.id;
  delete payload.user_id; // never allow reassigning ownership

  const { data, error } = await getAdmin()
    .from('tender_responses')
    .update(payload)
    .eq('id', id)
    .eq('user_id', user.id) // ownership check — service_role bypasses RLS, so enforce here
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ row: data });
});

/**
 * DELETE /api/tender-responses/:id
 * Delete a draft owned by the caller.
 */
router.delete('/:id', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  const { error } = await getAdmin()
    .from('tender_responses')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

export default router;
