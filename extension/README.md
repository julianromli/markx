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

- A content script on the configured markx origin calls
  `/api/auth/get-session` (same-origin, cookies work) and forwards the
  session token to the extension.
- API calls to `/api/extension/*` send `Authorization: Bearer <token>`.
  The Worker verifies the JWT with the Neon Auth JWKS, the same way
  server functions already do.

## Production

The Worker must be deployed with the new `/api/extension/*` routes and
CORS for `chrome-extension://` origins before a production install will
work. Chrome Web Store listing and extension IDs are not part of this
change.
