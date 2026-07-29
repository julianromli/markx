# Mayar production cutover checklist — Markx

Use this when moving billing from **sandbox** (`api.mayar.club`) to **production** (`api.mayar.id`).

**Canonical app URL:** `https://markx.app`  
**Webhook path:** `https://markx.app/api/webhooks/mayar`  
**Success redirect:** `https://markx.app/subscription/success`  
**Worker:** `markx` (Cloudflare)  
**Related:** [payment-plan.md](./payment-plan.md) · PR payment branch

Do **not** put real API keys in this file or in git.

---

## Feature flag

Billing is gated by Worker **var** (not a secret):

| Var | Values | Default |
|-----|--------|---------|
| `MAYAR_BILLING_ENABLED` | `true` / `false` (also `1`/`yes`/`on`) | `false` in `wrangler.jsonc` |

When **off**: no free-tier entity limit, no Upgrade CTA, checkout rejects. Webhooks still run so Pro rows can be ready before flip.

**Turn on (production):** Cloudflare dashboard → Workers → `markx` → Settings → Variables → set `MAYAR_BILLING_ENABLED` = `true` (and redeploy if required), **or** set in `wrangler.jsonc` `vars` and `bun run deploy`.

**Local:** `MAYAR_BILLING_ENABLED=true` in `.dev.vars` overrides the wrangler default.

- [ ] Confirm flag is `false` until cutover is ready
- [ ] After secrets + webhook + first sandbox/prod proof: set `MAYAR_BILLING_ENABLED=true`

---

## Pre-flight (sandbox must already be green)

- [ ] With flag **on** in sandbox/local: sign in → Upgrade → pay test → `/subscription/success` → account menu shows **Pro**
- [ ] Free user with **>100** entities cannot save; Pro can
- [ ] Webhook test delivery **SUCCESS** to `https://markx.app/api/webhooks/mayar`
- [ ] Paid webhook activates `user_subscriptions.plan = pro` (idempotent on retry)
- [ ] Expire/unsubscribe webhook sets plan back to `free` (no data delete)
- [ ] Migration applied: `user_subscriptions`, `mayar_processed_transactions`
- [ ] PR merged (or production deploy includes payment commits)

---

## 1. Mayar production product

In [web.mayar.id](https://web.mayar.id) (production), not `.club`:

- [ ] Create / confirm **Membership & SaaS** product **Markx Pro**
- [ ] Tier: **Rp 49.000 / month**, published / **ACTIVE**
- [ ] Tier **Redirect URL** = `https://markx.app/subscription/success`  
  (Dashboard field — API often leaves tier `redirectUrl` empty; set it manually.)
- [ ] Optional: product-level redirect / payment-link update also points at success URL
- [ ] Copy IDs (keep offline, not in git):

  | Secret | Value |
  |--------|--------|
  | `MAYAR_MEMBERSHIP_PRODUCT_ID` | _(prod UUID)_ |
  | `MAYAR_MEMBERSHIP_TIER_ID` | _(prod UUID)_ |

- [ ] Create production API key: Integration → API Key  
  Scope: read + write as needed for membership + transactions

---

## 2. Cloudflare Worker secrets

Target Worker name: **`markx`**.  
Prefer `wrangler versions secret put` / `secret bulk`, then **deploy** so the live version has secrets (see note below).

| Secret | Production value |
|--------|------------------|
| `MAYAR_API_KEY` | Production key from web.mayar.id |
| `MAYAR_ENV` | `production` |
| `APP_URL` | `https://markx.app` |
| `MAYAR_MEMBERSHIP_PRODUCT_ID` | Prod product UUID |
| `MAYAR_MEMBERSHIP_TIER_ID` | Prod tier UUID |
| `DATABASE_URL` | Already set (do not overwrite unless intentional) |
| `NEON_AUTH_COOKIE_SECRET` | Already set |

### Suggested commands

```bash
# From repo root. Do not commit the JSON file.
cat > /tmp/markx-mayar-prod-secrets.json <<'EOF'
{
  "MAYAR_API_KEY": "PASTE_PROD_KEY",
  "MAYAR_ENV": "production",
  "APP_URL": "https://markx.app",
  "MAYAR_MEMBERSHIP_PRODUCT_ID": "PASTE_PROD_PRODUCT_ID",
  "MAYAR_MEMBERSHIP_TIER_ID": "PASTE_PROD_TIER_ID"
}
EOF

# If bulk fails with "latest version isn't currently deployed":
#   bun run deploy
# then bulk again, or use: wrangler versions secret put <NAME>

bunx wrangler secret bulk /tmp/markx-mayar-prod-secrets.json
rm -f /tmp/markx-mayar-prod-secrets.json

bun run deploy

bunx wrangler secret list
# Expect: APP_URL, MAYAR_*, DATABASE_URL, NEON_AUTH_COOKIE_SECRET
```

- [ ] Secrets uploaded  
- [ ] `bun run deploy` completed after secret change  
- [ ] `wrangler secret list` shows all `MAYAR_*` + `APP_URL`  
- [ ] Shred local secret files (`rm` temp JSON; clear shell history if needed)

**Note:** `MAYAR_ENV=production` switches the app to `https://api.mayar.id/hl/v2` (see `src/lib/mayar/env.ts`). No code change required for the host switch.

---

## 3. Production webhook

Use production Mayar CLI (default is production unless `--sandbox`):

```bash
export MAYAR_API_KEY="PASTE_PROD_KEY"   # or: npx -y mayar@latest api-key …

npx -y mayar@latest whoami --json
# valid: true, production account

npx -y mayar@latest webhook register https://markx.app/api/webhooks/mayar

npx -y mayar@latest webhook test https://markx.app/api/webhooks/mayar

npx -y mayar@latest webhook new-history --limit 5 --json
# Latest test row: status SUCCESS, url https://markx.app/api/webhooks/mayar
```

- [ ] `whoami` valid on **production**  
- [ ] Webhook registered to `https://markx.app/api/webhooks/mayar`  
- [ ] Test delivery **SUCCESS** (not an old tunnel / workers.dev-only URL)  
- [ ] Dashboard Integration → Webhook shows the same URL if UI is used  

Also confirm:

```bash
curl -sS -X POST https://markx.app/api/webhooks/mayar \
  -H 'content-type: application/json' \
  -d '{"event":"ping"}'
# {"ok":true}
```

- [ ] Public POST returns `{"ok":true}`

---

## 4. Deploy app (if not already on markx.app)

- [ ] Payment commits on the branch that production serves  
- [ ] `bun run deploy` (or CI) to Worker behind `markx.app`  
- [ ] Smoke: `https://markx.app/subscription/success` → 200  
- [ ] Smoke: account menu loads for a signed-in user  

---

## 5. Enable billing flag + production payment proof

- [ ] Set `MAYAR_BILLING_ENABLED=true` on the production Worker and deploy if needed
- [ ] Confirm Upgrade CTA visible for a free signed-in user

Use a real card/QRIS with a test account you control.

- [ ] Sign in on `https://markx.app` with a known email  
- [ ] Upgrade → enter mobile → complete **production** checkout (Rp 49.000)  
- [ ] Redirect lands on `https://markx.app/subscription/success`  
- [ ] Within ~30s: success page or account menu shows **Markx Pro**  
- [ ] DB: `user_subscriptions` row `plan=pro`, `status=active`, `mayar_member_id` set  
- [ ] DB: `mayar_processed_transactions` has the paid `transaction_id`  
- [ ] Replay / duplicate webhook does **not** error and does not double-charge entitlements  
- [ ] `npx -y mayar@latest webhook new-history --limit 5` shows `payment.received` delivery **SUCCESS** to markx.app  

Optional hardening after first pay:

- [ ] Cancel or wait for expire in Mayar → webhook → plan returns to `free`  
- [ ] User with >100 entities while free: save rejected + upgrade CTA  

---

## 6. Rollback (if something breaks)

- [ ] Set Worker `MAYAR_ENV=sandbox` **or** remove/rotate bad prod key and redeploy  
- [ ] Or temporarily point webhook away / disable Upgrade CTA in a hotfix  
- [ ] Do **not** drop `user_subscriptions` — revoke by setting `plan=free` if needed  
- [ ] Refund via Mayar dashboard if a bad live charge occurred  

```bash
# Emergency: back to sandbox keys (only if sandbox product still valid)
# wrangler versions secret put MAYAR_ENV  → sandbox
# wrangler versions secret put MAYAR_API_KEY → sandbox key
# restore sandbox product/tier IDs
bun run deploy
```

---

## 7. Post-cutover ops

- [ ] Monitor Worker logs for `[mayar webhook]` lines for 24–48h  
- [ ] Watch Mayar webhook history for FAILED deliveries; retry if needed  
- [ ] Confirm no sandbox keys remain in production Worker secrets  
- [ ] Local `.dev.vars` stays **sandbox** + `APP_URL=http://localhost:3000`  
- [ ] Document prod product/tier IDs in team password manager (not git)  
- [ ] When Mayar ships HMAC webhooks: replace verify-by-fetch (TODO in `src/routes/api/webhooks/mayar.ts`)  

---

## Quick reference

| Item | Value |
|------|--------|
| App | `https://markx.app` |
| Success | `https://markx.app/subscription/success` |
| Webhook | `https://markx.app/api/webhooks/mayar` |
| Sandbox API | `https://api.mayar.club/hl/v2` |
| Production API | `https://api.mayar.id/hl/v2` |
| Env switch | `MAYAR_ENV=production` \| `sandbox` |
| Feature flag | `MAYAR_BILLING_ENABLED=true` \| `false` |
| Price | Rp 49.000 / month |
| Free limit | 100 entities in workspace state |

### Code map

| Concern | Location |
|---------|----------|
| Env / base URL | `src/lib/mayar/env.ts` |
| Mayar HTTP | `src/lib/mayar/client.ts` |
| Checkout + entitlements | `src/lib/server/subscription.ts` / `subscription.server.ts` |
| Webhook | `src/routes/api/webhooks/mayar.ts` |
| Success UI | `src/routes/subscription/success.tsx` |
| Upgrade CTA | `src/components/markx/account-menu.tsx` |
| Entity limit | `src/lib/markx/entity-count.ts` + `workspace.server.ts` |
| Local bootstrap | `bun run mayar:bootstrap` / `scripts/mayar-bootstrap.mjs` |

---

## Sign-off

| Role | Name | Date | Notes |
|------|------|------|-------|
| Eng | | | Secrets + deploy |
| Eng | | | Webhook + first live pay |
| Owner | | | Prod product/price OK |

**Cutover complete when:** first real payment shows Pro on markx.app, webhook history SUCCESS, and rollback path is understood.
