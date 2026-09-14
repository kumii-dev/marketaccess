# Parent Platform Routing Instructions — Access To Market

> **Audience**: `kumii.africa` host platform team
> **Purpose**: Tells the parent platform exactly how to map its own public-facing
> URLs to the correct page inside the embedded Market Access iframe.

---

## 1. What the parent platform needs to do

The Market Access module is a single-page app, embedded via `<iframe>`, that
exposes three internal pages. The parent decides **which page to show** by
setting the iframe's `src` query string. No routing logic needs to run inside
the iframe on the parent's side — the child app reads the query param itself
on load.

Map the parent's public-facing routes to the iframe `src` as follows:

| Parent-facing URL (`kumii.africa`) | Iframe `src` to set |
|---|---|
| `https://kumii.africa/access-to-market` | `https://<market-access-domain>/` |
| `https://kumii.africa/access-to-market?view=smart-matched` | `https://<market-access-domain>/?view=smart-matched-tenders` |
| `https://kumii.africa/access-to-market?view=my-tenders` | `https://<market-access-domain>/?view=my-tenders` |

Replace `<market-access-domain>` with the deployed Market Access URL
(currently `https://marketaccess.vercel.app`).

> ℹ️ The child app also accepts the shorthand `?view=smart-matched` directly
> (it is aliased internally to `smart-matched-tenders`), so passing either
> value through works. Using the full `smart-matched-tenders` value is
> slightly more explicit/future-proof if the parent ever changes its own
> route naming.

---

## 2. Two supported integration options

### Option A — Set the iframe `src` (simplest, recommended for route changes)

Use this whenever the **parent's own route** changes (e.g. the user navigates
to `/access-to-market?view=my-tenders` in the host app). Just set/update the
iframe's `src` attribute — the child app reads `?view=` on load and renders
the matching page automatically.

```html
<!-- Default (Browse Opportunities) -->
<iframe id="market-access-iframe"
        src="https://marketaccess.vercel.app/"
        allow="clipboard-read; clipboard-write">
</iframe>
```

```js
// When the host route is /access-to-market?view=smart-matched
document.getElementById('market-access-iframe').src =
  'https://marketaccess.vercel.app/?view=smart-matched-tenders';

// When the host route is /access-to-market?view=my-tenders
document.getElementById('market-access-iframe').src =
  'https://marketaccess.vercel.app/?view=my-tenders';
```

⚠️ Changing `src` causes a full iframe reload. This is fine for a normal page
navigation (the user is already navigating to a new host URL anyway), but if
the iframe is already mounted and you want to switch pages **without a
reload**, use Option B instead.

### Option B — `postMessage` into an already-loaded iframe (no reload)

Use this if the host keeps the iframe persistently mounted (e.g. a
single-page host shell) and wants to switch the embedded page without
reloading it — for example, clicking a nav item in the host's own UI while
the Market Access iframe stays alive in the background.

```js
const iframe = document.getElementById('market-access-iframe');

// Route to Smart Matched Tenders
iframe.contentWindow.postMessage(
  { type: 'KUMII_SET_VIEW', view: 'smart-matched-tenders' },
  'https://marketaccess.vercel.app' // always use an explicit target origin in production
);

// Route to My Tenders
iframe.contentWindow.postMessage(
  { type: 'KUMII_SET_VIEW', view: 'my-tenders' },
  'https://marketaccess.vercel.app'
);

// Route back to Browse Opportunities (default)
iframe.contentWindow.postMessage(
  { type: 'KUMII_SET_VIEW', view: 'government-tenders' },
  'https://marketaccess.vercel.app'
);
```

The child app mirrors whichever section is active back into its own URL
(`?view=...`) via `history.replaceState`, so if the iframe is ever reloaded
afterward it still shows the last-viewed page.

---

## 3. Accepted `view` values

| Value | Page shown |
|---|---|
| *(omitted)* or `government-tenders` | Browse Opportunities (default) |
| `smart-matched-tenders` (alias: `smart-matched`) | Smart Matched Tenders |
| `my-tenders` | My Tenders |
| `private-tenders` | Private Tenders (currently hidden from in-app nav, but still routable) |

Any other/unrecognised value falls back to Browse Opportunities.

---

## 4. Quick reference — exact mapping requested

```
https://kumii.africa/access-to-market                       →  /                              (Browse Opportunities)
https://kumii.africa/access-to-market?view=smart-matched     →  ?view=smart-matched-tenders    (Smart Matched Tenders)
https://kumii.africa/access-to-market?view=my-tenders        →  ?view=my-tenders               (My Tenders)
```

---

## 5. Related reference

For the full postMessage catalogue (auth handshake, document opening, etc.),
see `KUMII-IFRAME-INTEGRATION-GUIDE.md` in this repo — this document only
covers the routing/deep-linking piece.
