/**
 * True when this app is running inside an iframe (e.g. embedded at
 * https://kumii.africa/access-to-market). The kumii.africa parent surfaces
 * its own "Browse Opportunities / Smart Matched Tenders / My Tenders"
 * navigation, so child pages should hide their replica header nav buttons
 * when embedded to avoid duplicate controls.
 */
export function isEmbedded() {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access to window.top can throw — treat as embedded.
    return true;
  }
}
