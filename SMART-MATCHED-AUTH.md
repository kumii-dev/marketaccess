# Smart Matched Tenders - Parent Window Integration

## Overview
The Smart Matched Tenders feature requires authentication from the parent window (kumii.africa) to fetch user profile data and match tenders.

## Parent Window Implementation

Add this code to the parent window (kumii.africa) where the iframe is embedded:

```javascript
// Get reference to the iframe
const marketAccessIframe = document.querySelector('iframe[src*="marketaccess"]');

// Listen for authentication token requests from iframe
window.addEventListener('message', (event) => {
  // Security: Verify origin
  if (event.origin !== 'https://marketaccess.vercel.app') {
    return;
  }

  // Handle token request
  if (event.data && event.data.type === 'REQUEST_AUTH_TOKEN') {
    console.log('Iframe requesting auth token');
    
    // Get the user's authentication token from your auth system
    // This should be the Supabase JWT token for the logged-in user
    const authToken = getUserAuthToken(); // Replace with your actual token retrieval
    
    // Send token to iframe
    if (authToken && marketAccessIframe) {
      marketAccessIframe.contentWindow.postMessage({
        type: 'KUMII_AUTH_TOKEN',
        token: authToken
      }, 'https://marketaccess.vercel.app');
      
      console.log('Sent auth token to iframe');
    }
  }
});

// Helper function to get user's auth token
function getUserAuthToken() {
  // Option 1: If using Supabase on parent window
  // const { data: { session } } = await supabase.auth.getSession();
  // return session?.access_token;
  
  // Option 2: If storing token in localStorage
  // return localStorage.getItem('supabase.auth.token');
  
  // Option 3: If using a different auth system
  // return yourAuthSystem.getToken();
  
  // TODO: Replace with your actual token retrieval logic
  return null;
}

// Optional: Send token immediately on page load if user is already authenticated
window.addEventListener('load', () => {
  const authToken = getUserAuthToken();
  if (authToken && marketAccessIframe) {
    marketAccessIframe.contentWindow.postMessage({
      type: 'KUMII_AUTH_TOKEN',
      token: authToken
    }, 'https://marketaccess.vercel.app');
  }
});
```

## Security Notes

1. **Origin Validation**: Always verify `event.origin` to ensure messages are from trusted sources
2. **Token Security**: Never expose tokens in console logs in production
3. **HTTPS Only**: Authentication tokens should only be transmitted over HTTPS
4. **Token Refresh**: If tokens expire, send updated tokens via the same postMessage mechanism

## Token Requirements

The token must be a valid Supabase JWT token that has access to:
- `https://qypazgkngxhazgkuevwq.supabase.co/functions/v1/api-read-profiles?type=both`

## Testing

To test locally:

1. Open browser console on kumii.africa
2. Get the iframe reference:
   ```javascript
   const iframe = document.querySelector('iframe[src*="marketaccess"]');
   ```
3. Send a test token:
   ```javascript
   iframe.contentWindow.postMessage({
     type: 'KUMII_AUTH_TOKEN',
     token: 'your-test-token-here'
   }, 'https://marketaccess.vercel.app');
   ```

## Troubleshooting

**Issue**: "Waiting for Authentication" message persists

**Solutions**:
1. Check browser console for postMessage logs
2. Verify the token is being sent from parent window
3. Verify the token is valid and not expired
4. Check that the iframe src origin matches the postMessage target origin
5. Ensure CORS and CSP headers allow iframe communication

**Issue**: Profile data fails to load

**Solutions**:
1. Verify token has correct permissions for the Supabase function
2. Check network tab for failed API requests
3. Verify the Supabase function endpoint is accessible
4. Check token expiration

## Flow Diagram

```
┌─────────────────┐                    ┌──────────────────┐
│  kumii.africa   │                    │  marketaccess    │
│ (Parent Window) │                    │    (Iframe)      │
└────────┬────────┘                    └────────┬─────────┘
         │                                      │
         │    Page loads, iframe initializes   │
         │◄─────────────────────────────────────┤
         │                                      │
         │  postMessage: REQUEST_AUTH_TOKEN     │
         │◄─────────────────────────────────────┤
         │                                      │
    Get user token                              │
    from auth system                            │
         │                                      │
         │  postMessage: KUMII_AUTH_TOKEN       │
         ├─────────────────────────────────────►│
         │         { type, token }              │
         │                                      │
         │                           Fetch profile data
         │                           Match tenders
         │                           Display results
         │                                      │
```
