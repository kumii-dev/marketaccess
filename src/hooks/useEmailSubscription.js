/**
 * useEmailSubscription
 * =====================
 * Manages the user's tender digest email subscription:
 *   - Loads current settings from the server on mount
 *   - Exposes save() and unsubscribe() mutations
 *   - Exposes sendTest() for "Send now" button
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const API_BASE =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001' : '');

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useEmailSubscription() {
  const [subscription, setSubscription] = useState(null); // null = not loaded yet
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [testSending, setTestSending]   = useState(false);
  const [error, setError]               = useState(null);
  const [successMsg, setSuccessMsg]     = useState('');

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      if (!headers.Authorization) { setLoading(false); return; }

      const res = await fetch(`${API_BASE}/api/email/subscription`, { headers });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const { subscription: sub } = await res.json();
      setSubscription(sub); // null if not subscribed yet
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Save (create or update) ───────────────────────────────────────────────
  const save = useCallback(async ({ email, frequency, minScore, enabled = true }) => {
    setSaving(true);
    setError(null);
    setSuccessMsg('');
    try {
      const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
      const res = await fetch(`${API_BASE}/api/email/subscription`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, frequency, minScore, enabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error ${res.status}`);
      }
      const { subscription: sub } = await res.json();
      setSubscription(sub);
      setSuccessMsg('✅ Subscription saved!');
      setTimeout(() => setSuccessMsg(''), 3500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, []);

  // ── Unsubscribe ───────────────────────────────────────────────────────────
  const unsubscribe = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const headers = await authHeaders();
      await fetch(`${API_BASE}/api/email/subscription`, { method: 'DELETE', headers });
      setSubscription(prev => prev ? { ...prev, enabled: false } : prev);
      setSuccessMsg('Unsubscribed. You will no longer receive digest emails.');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, []);

  // ── Send test ─────────────────────────────────────────────────────────────
  const sendTest = useCallback(async ({ email, minScore, frequency }) => {
    setTestSending(true);
    setError(null);
    setSuccessMsg('');
    try {
      const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
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
  }, []);

  return { subscription, loading, saving, testSending, error, successMsg, save, unsubscribe, sendTest, reload: load };
}
