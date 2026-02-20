# Parent Window Handler for Document Downloads

## Problem
When the Market Access app is embedded in an iframe on kumii.africa, browser security restrictions prevent opening documents in new tabs, resulting in `about:blank` pages.

## Solution
Add this message listener to the **parent page (kumii.africa)** to handle document opening from the iframe.

---

## Code to Add to kumii.africa

Add this script to your kumii.africa page (preferably in the `<head>` section or before the closing `</body>` tag):

```html
<script>
  // Listen for messages from the Market Access iframe
  window.addEventListener('message', function(event) {
    // Verify the message is from a trusted source
    // Update this to match your actual iframe source
    const trustedOrigins = [
      'https://marketaccess.vercel.app',
      'https://marketaccess-kumii-devs-projects.vercel.app',
      'http://localhost:5173',
      'http://localhost:5174'
    ];
    
    // Check if message is from trusted origin
    if (!trustedOrigins.includes(event.origin)) {
      console.log('Ignoring message from untrusted origin:', event.origin);
      return;
    }
    
    // Handle document opening requests
    if (event.data && event.data.type === 'OPEN_DOCUMENT') {
      const url = event.data.url;
      console.log('Parent window opening document:', url);
      
      // Open in new tab from parent window (won't be blocked)
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, false);
  
  console.log('Market Access iframe message listener initialized');
</script>
```

---

## How It Works

1. **Market Access app** (in iframe) detects it's embedded
2. When user clicks "Download Document", it sends a `postMessage` to the parent window
3. **Parent window** (kumii.africa) receives the message
4. **Parent window** opens the document in a new tab (this won't be blocked)

---

## Testing

After adding the code to kumii.africa:

1. Open: https://kumii.africa/access-to-market
2. Click on any tender card
3. Click "Download Document"
4. Document should open in a new tab ✅

---

## Security Notes

- The `trustedOrigins` array ensures only messages from your Market Access app are processed
- Add your production Vercel URL to the trusted origins list
- The `noopener,noreferrer` flags prevent security issues with new tabs

---

## Alternative: Lovable Settings

If you're using Lovable's visual editor, you can also add this as a **Custom Code Block**:

1. Go to your kumii.africa page in Lovable
2. Add a **Custom Code** component
3. Paste the script above
4. Save and publish

---

## Troubleshooting

If documents still don't open:

1. **Check browser console** for messages:
   - Should see: "Market Access iframe message listener initialized"
   - Should see: "Posted message to parent window: [url]"
   - Should see: "Parent window opening document: [url]"

2. **Verify iframe source matches**: The `event.origin` must match one of the `trustedOrigins`

3. **Check popup blocker**: Some browsers may still block popups - users need to allow popups for kumii.africa

---

## Questions?

If you need help implementing this, let me know!
