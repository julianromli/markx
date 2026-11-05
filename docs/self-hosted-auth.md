# Self-hosted auth (Better Auth)

markx signs users in with **email + one-time code only**. Better Auth runs
inside the Worker at `/api/auth/*`. There is no OAuth and no password.

## Pieces

| Piece | Where |
|---|---|
| Better Auth config (email OTP, 6 digits, 10 min, hashed codes) | `src/lib/auth/server.ts` |
| OTP mail via Cloudflare Email Service (`EMAIL` binding) | `src/lib/auth/otp-email.ts` |
| `/api/auth/*` handler + per-isolate OTP send throttle | `src/server.ts` |
| Session check for server functions | `src/lib/auth/middleware.ts` |
| Browser client | `src/lib/auth/client.ts`, `auth-client-factory.ts` |
| Tables (`auth.user`, `auth.session`, `auth.account`, `auth.verification`) | `src/lib/db/auth-schema.ts`, `scripts/sql/auth-schema.sql` |
| One-time "please sign in again" banner | `src/lib/markx/relogin-notice.ts`, `src/components/markx/relogin-banner.tsx` |

Ids are `uuid`. Production data comes from the Neon Auth `neon_auth` schema,
restored into the VPS database and renamed to `auth`, so user ids (and every
`workspaces.user_id` etc.) stay the same. Neon-only columns stay in place and
Better Auth ignores them. The auth tables are not in `drizzle.config.ts`.

## Configuration

| Name | Kind | Value |
|---|---|---|
| `BETTER_AUTH_SECRET` | secret | `openssl rand -base64 32`; `wrangler secret put BETTER_AUTH_SECRET` |
| `BETTER_AUTH_URL` | var | `https://markx.app` (wrangler.jsonc) |
| `BETTER_AUTH_TRUSTED_ORIGINS` | var, optional | comma-separated extra origins, e.g. a rehearsal preview URL |
| `EMAIL` | `send_email` binding | sender `welcome@markx.faizintifada.com` ("Markx") |
| `HYPERDRIVE` | binding | Hyperdrive config for db `markx` on the VPS |

The sending domain `markx.faizintifada.com` must be onboarded in Cloudflare
Email Service (`wrangler email sending enable markx.faizintifada.com`, or the
dashboard), with its SPF/DKIM records live. Until then the binding throws
`E_SENDER_DOMAIN_NOT_AVAILABLE` / `E_SENDER_NOT_VERIFIED`, logged as
`[auth] OTP email failed`.

## Local development

1. Start any Postgres you own (never production) and create a database.
2. `psql "$DATABASE_URL" -f scripts/sql/auth-schema.sql`
3. `DATABASE_URL=... bun run db:migrate`
4. Copy `.dev.vars.example` to `.dev.vars` and fill `DATABASE_URL` (with a
   password; local Hyperdrive needs one) and `BETTER_AUTH_SECRET`.
5. `bun run dev`. The `EMAIL` binding is simulated: the dev log prints the
   subject (it contains the code) and the path of the saved message.

The Postgres integration test runs when `AUTH_TEST_DATABASE_URL` points at a
throwaway database with `scripts/sql/auth-schema.sql` applied:

```bash
AUTH_TEST_DATABASE_URL=postgres://... bunx vitest run src/lib/auth/server.test.ts
```
