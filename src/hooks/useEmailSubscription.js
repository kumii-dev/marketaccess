/**
 * useEmailSubscription
 * =====================
 * Manages the user's tender digest email subscription.
 *
 * Auth — same two-path pattern as SmartMatchedTenders:
 *   Path A: local Supabase session  (standalone / dev mode)
 *   Path B: KUMII_AUTH_TOKEN postMessage from kumii.africa parent iframe
 *
 * The hook resolves a JWT before making any API call, so "Unauthorized"
 * cannot occur when running inside the Kumii platform iframe.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

const API_BASE =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001' : '');

export function useEmailSubscription() {
  // ── Auth token (Path A: Supabase session | Path B: postMessage) ──────────
  const [authToken, setAuthToken] = useState(null);
  const tokenRef = useRef(null);  // always reflects latest token in callbacks
  useEffect(() => { tokenRef.current = authToken; }, [authToken]);

  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [testSending, setTestSending]   = useState(false);
  const [error, setError]               = useState(null);
  const [successMsg, setSuccessMsg]     = useState('');

  // ── Resolve JWT ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    // Path A: direct Supabase session (standalone / dev)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled && session?.access_token) {
        setAuthToken(session.access_token);
      }
    });

    // Catch future session changes / token refreshes
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!cancelled && session?.access_token) {
          setAuthToken(session.access_token);
        }
      }
    );

    // Path B: token pushed via postMessage from kumii.africa parent iframe
    const handleMessage = (event) => {
      if (event.data?.type === 'KUMII_AUTH_TOKEN' && event.data.token && !cancelled) {
        setAuthToken(event.data.token);
      }
    };
    window.addEventListener('message', handleMessage);

    // Ask the parent for a token when actually embedded inside an iframe
    if (window.parent !== window.self) {
      window.parent.postMessage({ type: 'REQUEST_AUTH_TOKEN' }, '*');
    }

    return () => {
      cancelled = true;
      authSub.unsubscribe();
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // ── Build Authorization header (returns null if no token yet) ────────────
  const makeHeaders = useCallback((extra = {}) => {
    const token = tokenRef.current;
    if (!token) return null;
    return { Authorization: `Bearer ${token}`, ...extra };
  }, []);

  // ── Load subscription ─────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const headers = makeHeaders();
    if (!headers) { setLoading(false); return; } // token not yet available

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/email/subscription`, { headers });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const { subscription: sub } = await res.json();
      setSubscription(sub);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [makeHeaders]);

  // Load once the token is resolved
  useEffect(() => {
    if (authToken) load();
  }, [authToken, load]);

  // ── Save (upsert) ─────────────────────────────────────────────────────────
  const save = useCallback(async ({ email, frequency, minScore, enabled = true }) => {
    const headers = makeHeaders({ 'Content-Type': 'application/json' });
    if (!headers) { setError('Not authenticated. Please log in.'); return; }

    setSaving(true);
    setError(null);
    setSuccessMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/email/subscription`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, frequency, minScore, enabled }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Server error ${res.status}`);
      setSubscription(body.subscription);
      setSuccessMsg('✅ Subscription saved!');
      setTimeout(() => setSuccessMsg(''), 3500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [makeHeaders]);

  // ── Unsubscribe ───────────────────────────────────────────────────────────
  const unsubscribe = useCallback(async () => {
    const headers = makeHeaders();
    if (!headers) { setError('Not authenticated.'); return; }

    setSaving(true);
    setError(null);
    try {
      await fetch(`${API_BASE}/api/email/subscription`, { method: 'DELETE', headers });
      setSubscription(prev => prev ? { ...prev, enabled: false } : prev);
      setSuccessMsg('Unsubscribed. You will no longer receive digest emails.');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [makeHeaders]);

  // ── Send test digest immediately ──────────────────────────────────────────
  const sendTest = useCallback(async ({ email, minScore, frequency }) => {
    const headers = makeHeaders({ 'Content-Type': 'application/json' });
    if (!headers) { setError('Not authenticated. Please log in.'); return; }

    setTestSending(true);
    setError(null);
    setSuccessMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/email/send-test`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, minScore, frequency }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Server error ${res.status}`);
      setSuccessMsg(`✅ Test digest sent! (${body.count} tenders)`);
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setTestSending(false);
    }
  }, [makeHeaders]);

  return {
    subscription,
    loading,
    saving,
    testSending,
    error,
    successMsg,
    authReady: !!authToken,
    save,
    unsubscribe,
    sendTest,
    reload: load,
  };
}
