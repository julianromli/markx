# markx Chrome extension

Save the current tab into a folder on your markx board.

## Load unpacked

1. From the repo root: `bun run extension:build`
2. Open `chrome://extensions`, enable Developer mode, and "Load unpacked"
   → select `extension/dist`.
3. Sign in to markx in the browser (https://markx.app, or your local dev
   server). Opening the app once lets the content script capture a session
   token.
4. To point the extension at a local server, right-click the icon → Options
   and set the base URL to `http://localhost:3000`.

Keyboard shortcut: `Cmd+Shift+S` (macOS) or `Ctrl+Shift+S` (Windows/Linux).

## Auth

The markx app uses SameSite=Lax first-party cookies on `/api/auth`. Those
cookies are not sent from a `chrome-extension://` origin, and this project
does not change cookie SameSite (that would affect the main app).

The extension instead uses the existing Bearer JWT path:

- A content script on the configured markx origin fetches
  `/api/auth/token` (same-origin, cookies work) for a Neon Auth JWT,
  falling back to the `set-auth-jwt` header on `/api/auth/get-session`.
  Better Auth's opaque `session.token` is not a JWT and is not used.
- API calls to `/api/extension/*` send `Authorization: Bearer <jwt>`.
  The Worker verifies it with the Neon Auth JWKS, the same way
  server functions already do.
- The JWT is short-lived (~15 minutes). On a 401 the popup asks the
  background to refresh once: it tries `/api/auth/token` from the
  service worker, then asks any open markx tab to recapture same-origin.
  A fetch from `chrome-extension://` may not attach SameSite=Lax
  cookies, so a worker 401 is not treated as signed out. A markx tab
  also recaptures the JWT on focus or visibility. Storage is cleared
  only when a markx tab (or the content script) confirms signed out,
  not on a network error.

## Production

The Worker must be deployed with the new `/api/extension/*` routes and
CORS for `chrome-extension://` origins before a production install will
work. Chrome Web Store listing and extension IDs are not part of this
change.
