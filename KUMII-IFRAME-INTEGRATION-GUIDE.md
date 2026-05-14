# 🔗 Kumii iFrame Integration — Replication Guide

> **Version**: 1.0  
> **Source system**: Market Access (`marketaccess` repo)  
> **Target system**: Kumii Learning Hub  
> **Date**: 2026-05-14

---

## 📐 What This Guide Covers

This guide captures every pattern used to embed the Market Access app inside
`kumii.africa` via an `<iframe>`. Use it as the authoritative blueprint when
wiring the Learning Hub into the same Kumii platform shell.

Topics covered:

1. [Architecture overview](#1-architecture-overview)
2. [Auth handshake — how JWT travels from Host → iFrame](#2-auth-handshake)
3. [postMessage message catalogue](#3-postmessage-message-catalogue)
4. [Child app implementation (the embedded module)](#4-child-app-implementation)
5. [Parent app implementation (kumii.africa host)](#5-parent-app-implementation)
6. [Security rules](#6-security-rules)
7. [Testing locally](#7-testing-locally)
8. [Lovable / CMS deployment checklist](#8-lovable--cms-deployment-checklist)
9. [Adapting for the Learning Hub](#9-adapting-for-the-learning-hub)
10. [Anti-patterns to avoid](#10-anti-patterns-to-avoid)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────┐
│  kumii.africa  (HOST — Next.js / Lovable)    │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  <iframe src="https://module.vercel.app">│ │
│  │                                        │  │
│  │   Embedded Module (React / Next.js)    │  │
│  │   - No login UI                        │  │
│  │   - Receives JWT via postMessage       │  │
│  │   - Sends actions to parent            │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  postMessage bridge  ◄──────────────────►   │
│  (window.parent / window.addEventListener)   │
└──────────────────────────────────────────────┘
```

**Key principles:**

| Concern | Owner |
|---|---|
| Authentication / SSO | Kumii Host |
| JWT token supply | Kumii Host → pushes token to iframe |
| Business logic | Embedded module |
| Navigation between Kumii pages | Parent, triggered by module postMessage |
| Document / popup opening | Parent, triggered by module postMessage |

---

## 2. Auth Handshake

### Flow diagram

```
Child boots
  │
  ├─ Path A: Is there a local Supabase session?
  │   YES → use session.access_token directly (standalone / dev mode)
  │   NO  → fall through to Path B
  │
  └─ Path B: Is window.parent !== window.self?
      YES → send REQUEST_AUTH_TOKEN to parent
              Parent receives it → sends KUMII_AUTH_TOKEN back
              Child stores token → proceeds
      NO  → show "waiting for authentication" UI
```

### Why two paths?

- **Path A** lets developers run the module standalone (e.g. `localhost:5173`)
  without needing a parent page.
- **Path B** is the production path when the module is embedded in
  `kumii.africa`.

### Token format

The parent sends a Supabase JWT (`session.access_token`).  
The child attaches it as `Authorization: Bearer <token>` to every API call.

---

## 3. postMessage Message Catalogue

All messages follow this envelope shape:

```js
{ type: 'MESSAGE_TYPE', ...payload }
```

### Messages sent **child → parent**

| `type` | Payload | Parent action |
|---|---|---|
| `REQUEST_AUTH_TOKEN` | *(none)* | Parent replies with `KUMII_AUTH_TOKEN` |
| `OPEN_DOCUMENT` | `{ url: string }` | Parent calls `window.open(url, '_blank')` |
| `NAVIGATE_TO_PROFILE` | *(none)* | Parent routes to `/profile` |
| `NAVIGATE_TO_TENDERS` | *(none)* | Parent routes to `/access-to-market` |

> **Learning Hub additions** — extend this catalogue with module-specific
> events, e.g. `NAVIGATE_TO_COURSES`, `CERTIFICATE_ISSUED`, `COURSE_COMPLETED`.

### Messages sent **parent → child**

| `type` | Payload | Child action |
|---|---|---|
| `KUMII_AUTH_TOKEN` | `{ token: string }` | Child stores JWT, unblocks all API calls |

---

## 4. Child App Implementation

### 4a. Detect iframe context

```js
// Utility — use throughout the app
export const isEmbedded = () => window.self !== window.top;
```

### 4b. Auth bootstrap hook

Place this in the top-level component (or a custom `useKumiiAuth` hook):

```js
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase'; // your Supabase client

export function useKumiiAuth() {
  const [authToken, setAuthToken] = useState(null);
  const [isWaitingForAuth, setIsWaitingForAuth] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // ── Path A: standalone / logged-in session ──────────────────────────────
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.access_token) {
        setAuthToken(session.access_token);
        setIsWaitingForAuth(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (cancelled) return;
        if (session?.access_token) {
          setAuthToken(session.access_token);
          setIsWaitingForAuth(false);
        }
      }
    );

    // ── Path B: iframe mode — request token from parent ─────────────────────
    const handleMessage = (event) => {
      // 🔒 Always validate origin in production (see §6)
      if (event.data?.type === 'KUMII_AUTH_TOKEN' && event.data.token) {
        if (!cancelled) {
          setAuthToken(event.data.token);
          setIsWaitingForAuth(false);
        }
      }
    };
    window.addEventListener('message', handleMessage);

    if (isEmbedded()) {
      window.parent.postMessage({ type: 'REQUEST_AUTH_TOKEN' }, '*');
    }

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  return { authToken, isWaitingForAuth };
}
```

### 4c. Opening documents / external links

Browser security blocks `window.open()` inside cross-origin iframes.
Delegate to the parent instead:

```js
export function openDocument(url) {
  if (isEmbedded()) {
    window.parent.postMessage({ type: 'OPEN_DOCUMENT', url }, '*');
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
```

### 4d. Triggering parent navigation

```js
export function navigateTo(destination) {
  // destination = 'PROFILE' | 'TENDERS' | 'COURSES' | etc.
  if (isEmbedded()) {
    window.parent.postMessage({ type: `NAVIGATE_TO_${destination}` }, '*');
  }
}
```

### 4e. Attach JWT to all API calls

```js
// src/lib/api.js  (or api/http.js in Next.js)
import axios from 'axios';

export function createAuthHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function apiFetch(url, token, options = {}) {
  return axios.get(url, {
    ...options,
    headers: {
      ...createAuthHeaders(token),
      ...options.headers,
    },
  });
}
```

### 4f. `vercel.json` — allow embedding

The child app **must** set `X-Frame-Options` and `Content-Security-Policy` to
permit the Kumii host to embed it:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Frame-Options",
          "value": "ALLOW-FROM https://kumii.africa"
        },
        {
          "key": "Content-Security-Policy",
          "value": "frame-ancestors 'self' https://kumii.africa https://*.kumii.africa"
        }
      ]
    }
  ]
}
```

> Replace `https://kumii.africa` with the exact production origin.

---

## 5. Parent App Implementation

Add the following script block to the Kumii platform page that hosts the
iframe. In Lovable, insert it as a **Custom Code** block on the relevant page.

### 5a. The `<iframe>` tag

```html
<iframe
  id="learningHubIframe"
  src="https://learning-hub.vercel.app"
  allow="clipboard-read; clipboard-write"
  style="width:100%; height:100vh; border:none;"
></iframe>
```

### 5b. Parent message handler script

```html
<script>
(function () {
  const TRUSTED_ORIGINS = [
    'https://learning-hub.vercel.app',
    'http://localhost:3000',   // Next.js dev
    'http://localhost:5173',   // Vite dev
  ];

  const iframe = document.getElementById('learningHubIframe');

  // ── Respond to messages from the child module ─────────────────────────────
  window.addEventListener('message', async function (event) {
    if (!TRUSTED_ORIGINS.includes(event.origin)) return; // 🔒 origin guard

    const { type, url } = event.data || {};

    // ── Auth handshake ──────────────────────────────────────────────────────
    if (type === 'REQUEST_AUTH_TOKEN') {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (token && iframe?.contentWindow) {
        iframe.contentWindow.postMessage(
          { type: 'KUMII_AUTH_TOKEN', token },
          TRUSTED_ORIGINS[0]          // 🔒 target origin — not '*' in production
        );
      }
    }

    // ── Open documents / external URLs ─────────────────────────────────────
    if (type === 'OPEN_DOCUMENT' && url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }

    // ── Navigation ──────────────────────────────────────────────────────────
    if (type === 'NAVIGATE_TO_PROFILE')  router.push('/profile');
    if (type === 'NAVIGATE_TO_COURSES')  router.push('/learn');
    if (type === 'NAVIGATE_TO_TENDERS')  router.push('/access-to-market');

    // Add more NAVIGATE_TO_* handlers as the module grows
  });

  // ── Push a fresh token whenever the session refreshes ────────────────────
  supabase.auth.onAuthStateChange((_event, session) => {
    const token = session?.access_token;
    if (token && iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: 'KUMII_AUTH_TOKEN', token },
        TRUSTED_ORIGINS[0]
      );
    }
  });
}());
</script>
```

---

## 6. Security Rules

| Rule | Reason |
|---|---|
| **Always check `event.origin`** in the parent listener | Prevents malicious third-party iframes from injecting fake tokens |
| **Use a specific `targetOrigin`** (not `'*'`) when sending `KUMII_AUTH_TOKEN` | JWT must never be broadcast to unknown origins |
| **Do not implement auth** inside the embedded module | Single source of truth — Kumii Host owns the session |
| **`noopener,noreferrer`** on all `window.open()` calls | Prevents tab-napping |
| **`frame-ancestors`** CSP in the child's `vercel.json` | Limits who can embed the module |
| **Rotate `TRUSTED_ORIGINS` per environment** | Separate lists for dev / staging / production |

---

## 7. Testing Locally

Use a dedicated test parent page (like `test-parent.html` in the Market Access
repo) to simulate the Kumii host without deploying:

```html
<!-- test-parent.html  (serve with: npx serve .) -->
<!DOCTYPE html>
<html>
<head><title>iFrame Test Harness</title></head>
<body>
  <input id="token" placeholder="Paste JWT here" style="width:60%">
  <button onclick="sendToken()">Send Token</button>

  <iframe
    id="child"
    src="http://localhost:3000"
    style="width:100%;height:90vh;border:1px solid #ccc;margin-top:8px"
    allow="clipboard-read; clipboard-write"
  ></iframe>

  <script>
    const iframe = document.getElementById('child');
    const CHILD_ORIGIN = 'http://localhost:3000';

    window.addEventListener('message', (e) => {
      if (!e.origin.includes('localhost')) return;
      console.log('[parent] received:', e.data);
      if (e.data?.type === 'REQUEST_AUTH_TOKEN') sendToken();
      if (e.data?.type === 'OPEN_DOCUMENT')      window.open(e.data.url, '_blank');
    });

    function sendToken() {
      const token = document.getElementById('token').value.trim();
      if (!token) return alert('Enter a token first');
      iframe.contentWindow.postMessage(
        { type: 'KUMII_AUTH_TOKEN', token },
        CHILD_ORIGIN
      );
      console.log('[parent] sent KUMII_AUTH_TOKEN');
    }

    iframe.addEventListener('load', () => setTimeout(sendToken, 800));
  </script>
</body>
</html>
```

**How to get a test JWT from the Kumii platform console:**

```js
(await supabase.auth.getSession()).data.session?.access_token
```

---

## 8. Lovable / CMS Deployment Checklist

| Step | Done? |
|---|---|
| Add `<iframe>` tag to the correct Lovable page | ☐ |
| Add parent message handler as a **Custom Code** block | ☐ |
| Update `TRUSTED_ORIGINS` with the production Vercel URL | ☐ |
| Set `X-Frame-Options` + `Content-Security-Policy` in child's `vercel.json` | ☐ |
| Verify `supabase` client is available on the Lovable page scope | ☐ |
| Test `REQUEST_AUTH_TOKEN` → `KUMII_AUTH_TOKEN` handshake end-to-end | ☐ |
| Test `OPEN_DOCUMENT` (popups should open from the parent tab) | ☐ |
| Test all `NAVIGATE_TO_*` routes | ☐ |
| Confirm `onAuthStateChange` re-sends token after session refresh | ☐ |

---

## 9. Adapting for the Learning Hub

The Learning Hub will need additional message types beyond what Market Access
uses. Add these to both the parent handler and the child module:

### Suggested new message types

| Direction | `type` | Payload | Purpose |
|---|---|---|---|
| child → parent | `COURSE_COMPLETED` | `{ courseId, userId }` | Trigger celebration / notification |
| child → parent | `CERTIFICATE_ISSUED` | `{ certificateId, courseId }` | Parent can log or display badge |
| child → parent | `NAVIGATE_TO_COURSES` | *(none)* | Parent routes to `/learn` |
| child → parent | `NAVIGATE_TO_PROFILE` | *(none)* | Parent routes to `/profile` |
| parent → child | `KUMII_AUTH_TOKEN` | `{ token }` | Same as Market Access |
| parent → child | `SET_PERSONA` | `{ persona }` | Push user persona for AI recommendations |

### Learning Hub `useKumiiAuth` additions

Since the Learning Hub receives a JWT with no login UI, extend the hook to also
decode the persona from the token payload:

```js
import { jwtDecode } from 'jwt-decode'; // npm i jwt-decode

export function useKumiiAuth() {
  const [authToken, setAuthToken] = useState(null);
  const [user, setUser]           = useState(null);

  // ... (same useEffect as §4b) ...

  // Decode user identity from JWT on token arrival
  useEffect(() => {
    if (!authToken) return;
    try {
      const payload = jwtDecode(authToken);
      setUser({
        id:      payload.sub,
        email:   payload.email,
        persona: payload.user_metadata?.persona || null,
      });
    } catch {
      console.warn('Could not decode JWT payload');
    }
  }, [authToken]);

  return { authToken, user };
}
```

### Express middleware for token validation

```js
// src/middleware/requireUser.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const requireUser = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  req.user = user; // { id, email, user_metadata: { persona } }
  next();
};
```

---

## 10. Anti-Patterns to Avoid

| ❌ Anti-pattern | ✅ Correct approach |
|---|---|
| Implementing login/signup inside the embedded module | Auth lives in Kumii Host only |
| Sending `KUMII_AUTH_TOKEN` with `targetOrigin: '*'` | Always specify exact `targetOrigin` |
| Not checking `event.origin` in the parent listener | Validate every incoming message origin |
| Calling `window.open()` directly inside the iframe | Send `OPEN_DOCUMENT` to parent |
| Hard-coding the JWT or storing it in `localStorage` | Token comes from parent on each session |
| Mixing navigation logic into the embedded module | Send `NAVIGATE_TO_*` to parent, let it route |
| Implementing business logic inside Express routes | Controllers call Services; routes only parse/respond |

---

## Reference Files (Market Access Repo)

| File | Purpose |
|---|---|
| `src/components/SmartMatchedTenders.jsx` | Full `useEffect` auth bootstrap implementation (Path A + B) |
| `src/components/TenderCard.jsx` | `OPEN_DOCUMENT` postMessage pattern |
| `IFRAME-PARENT-HANDLER.md` | Parent-side script instructions for Lovable |
| `test-parent.html` | Local test harness for the full handshake |
| `vercel.json` | `X-Frame-Options` and CSP headers |
