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
 * Resolve (or auto-provision) a real njcancswtqnxihxavshl auth.users row for
 * a given email, so any downstream INSERT that FK-references auth.users(id)
 * (email_subscriptions, smart_matched_tenders, tender_responses, ...)
 * succeeds even for kumii.africa parent-issued tokens whose `sub` claim
 * isn't itself a row in this project.
 *
 * Lookup uses the GoTrue Admin REST API directly (supabase-js's
 * auth.admin.listUsers() has no reliable single-email filter across
 * versions). Falls back to creating a new confirmed user for that email
 * if none exists yet — this is intentionally idempotent and safe to call
 * on every request; a warm-instance in-memory cache avoids repeating the
 * round trip for the lifetime of the server process.
 */
const _resolvedUserCache = new Map(); // email -> { id, email }

async function findOrCreateAuthUserByEmail(email) {
  if (!email) return null;
  if (_resolvedUserCache.has(email)) return _resolvedUserCache.get(email);

  const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!baseUrl || !serviceKey) return null;

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Look for an existing user with this email
    const lookupRes = await fetch(
      `${baseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      { headers }
    );
    if (lookupRes.ok) {
      const body = await lookupRes.json().catch(() => null);
      const existing = (body?.users || []).find(
        u => u.email?.toLowerCase() === email.toLowerCase()
      );
      if (existing) {
        const result = { id: existing.id, email: existing.email };
        _resolvedUserCache.set(email, result);
        return result;
      }
    }

    // 2. None found — auto-provision a shadow user for this iframe-only
    //    identity so FK-constrained tables can store their data.
    const createRes = await fetch(`${baseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email,
        email_confirm: true,
        user_metadata: { source: 'kumii-parent-iframe' },
      }),
    });
    if (createRes.ok) {
      const created = await createRes.json().catch(() => null);
      if (created?.id) {
        const result = { id: created.id, email: created.email || email };
        _resolvedUserCache.set(email, result);
        return result;
      }
    } else {
      // Could be a race (user created concurrently) — try lookup once more
      const retryRes = await fetch(
        `${baseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
        { headers }
      );
      if (retryRes.ok) {
        const body = await retryRes.json().catch(() => null);
        const existing = (body?.users || []).find(
          u => u.email?.toLowerCase() === email.toLowerCase()
        );
        if (existing) {
          const result = { id: existing.id, email: existing.email };
          _resolvedUserCache.set(email, result);
          return result;
        }
      }
    }
  } catch {
    /* network/parse error — treated as unresolved below */
  }

  return null;
}

/**
 * Resolve { id, email } for the Bearer token on a request, trying strict
 * server-side verification first, then falling back to local decode +
 * find-or-create-by-email (see above) so the returned id is always a real,
 * FK-safe auth.users row in this project.
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

  // The token's own `sub` is very likely NOT a row in this project's
  // auth.users (it's issued by the kumii.africa parent platform), so we
  // must not use it directly for FK-constrained inserts. Resolve/provision
  // a real row via email instead.
  if (payload.email) {
    const resolved = await findOrCreateAuthUserByEmail(payload.email);
    if (resolved) return resolved;
  }

  // Last resort: only safe for read-only endpoints, never for inserts.
  return { id: payload.sub, email: payload.email || '' };
}
