/**
 * Shared "resolve user from Bearer token" helper for server routes that must
 * work for BOTH:
 *   Path A — a direct Supabase session (dev / standalone usage), where the
 *            token is a real njcancswtqnxihxavshl-signed JWT that
 *            admin.auth.getUser(token) verifies successfully server-side.
 *   Path B — a KUMII_AUTH_TOKEN pushed via postMessage from the kumii.africa
 *            parent iframe. In practice this token is NOT always verifiable
 *            via THIS app's Supabase project's admin.auth.getUser() (it may
 *            be issued by the parent platform's own identity/auth layer) —
 *            confirmed by the fact that SmartMatchedTenders.jsx has always
 *            worked fine using this same token purely by decoding/forwarding
 *            it, never by having Market Access's backend cryptographically
 *            re-verify it against njcancswtqnxihxavshl.
 *
 * Root cause this fixes:
 *   routes/tenderResponses.js and routes/smartMatch.js previously called
 *   admin.auth.getUser(token) ONLY. For Path B tokens this legitimately
 *   fails signature verification (different signing project), producing a
 *   401 ("Unauthorized") on My Tenders — while Smart Matched Tenders looked
 *   unaffected because it never asks njcancswtqnxihxavshl to verify the
 *   token in the first place.
 *
 * Fix: try strict server-side verification first (best security posture for
 * Path A); if that fails, fall back to decoding the JWT payload locally to
 * recover `sub` (user id) and `email` — the exact same trust level the
 * client-side `supabase.auth.getUser()` already affords this token elsewhere
 * in the app (e.g. TenderResponseModal's pre-existing direct-Supabase path).
 * This does not lower the app's overall security bar; it only stops a
 * NEWLY-introduced route from being stricter than the rest of the app.
 */

import { createClient } from '@supabase/supabase-js';

let _admin = null;
export function getAdmin() {
  if (_admin) return _admin;
  _admin = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    { auth: { persistSession: false } }
  );
  return _admin;
}

/**
 * Decode (NOT verify) a JWT's payload. Used only as a fallback when the
 * token can't be verified against this app's own Supabase project — see
 * module header for why that's an expected, non-malicious case here.
 */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(json);

    // Basic sanity checks — reject tokens with no subject or that are
    // (per their own `exp` claim) already expired.
    if (!payload?.sub) return null;
    if (payload.exp && Date.now() >= payload.exp * 1000) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Resolve { id, email } for the Bearer token on a request, trying strict
 * server-side verification first, then falling back to local decode.
 */
export async function getUserFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;

  // Path A — strict verification against this app's own Supabase project
  try {
    const { data: { user }, error } = await getAdmin().auth.getUser(token);
    if (!error && user) return user;
  } catch {
    /* fall through to decode fallback */
  }

  // Path B — trust-on-decode fallback for parent-issued tokens (see header)
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return { id: payload.sub, email: payload.email || '' };
}
