# Mayar production cutover checklist — Markx

Use this when moving billing from **sandbox** (`api.mayar.club`) to **production** (`api.mayar.id`).

**Canonical app URL:** `https://markx.app`  
**Success redirect:** `https://markx.app/subscription/success`  
**Activation:** API-only (verify-on-read via `GET /transactions/{id}`) — **no Mayar webhook used or registered**
**Worker:** `markx` (Cloudflare)  
**Related:** [payment-plan.md](./payment-plan.md) · PR payment branch

Do **not** put real API keys in this file or in git.

---

## Feature flag

Billing is gated by Worker **var** (not a secret):

| Var | Values | Default |
|-----|--------|---------|
| `MAYAR_BILLING_ENABLED` | `true` / `false` (also `1`/`yes`/`on`) | `false` in `wrangler.jsonc` |

When **off**: no free-tier entity limit, no Upgrade CTA, checkout rejects, and entitlement reads skip Mayar re-checks.

**Turn on (production):** Cloudflare dashboard → Workers → `markx` → Settings → Variables → set `MAYAR_BILLING_ENABLED` = `true` (and redeploy if required), **or** set in `wrangler.jsonc` `vars` and `bun run deploy`.

**Local:** `MAYAR_BILLING_ENABLED=true` in `.dev.vars` overrides the wrangler default.

- [ ] Confirm flag is `false` until cutover is ready
- [ ] After secrets + first sandbox/prod proof: set `MAYAR_BILLING_ENABLED=true`

---

## Pre-flight (sandbox must already be green)

- [ ] With flag **on** in sandbox/local: sign in → Upgrade → pay test → `/subscription/success` → account menu shows **Pro**
- [ ] Free user with **>100** entities cannot save; Pro can
- [ ] Paid transaction activates `user_subscriptions.plan = pro` on entitlement read (idempotent on retry)
- [ ] Expired/inactive member downgrades plan back to `free` on read after period end (no data delete)
- [ ] Migration applied: `user_subscriptions` (+ `mayar_transaction_id`, `mayar_checked_at`), `mayar_processed_transactions`
- [ ] PR merged (or production deploy includes payment commits)

---

## 1. Mayar production account

Checkout is **custom QRIS in-app** (generic `/invoices/create` with
`paymentMethod: "qrcode"`); the app no longer uses a Mayar membership
product, hosted bill page, or tier redirect. What the production account
needs:

- [ ] **Direct-channel invoice creation enabled** — `paymentMethod` on
  `/invoices/create` must return `paymentDetail.qr_code.qr_string`. Not all
  accounts have this; if it 400s with "not available or disabled", ask Mayar
  support to enable direct/dynamic QRIS for the account.
- [ ] QRIS channel active (Integration → Payment Channels).
- [ ] Create production API key: Integration → API Key  
  Scope: read + write as needed for invoices + transactions

The membership product/tier from the earlier flow is unused by the code
(price comes from `MAYAR_PRO_PRICE_IDR`, default 49.000).

---

## 2. Cloudflare Worker secrets

Target Worker name: **`markx`**.  
Prefer `wrangler versions secret put` / `secret bulk`, then **deploy** so the live version has secrets (see note below).

| Secret/var | Production value |
|--------|------------------|
| `MAYAR_API_KEY` | Production key from web.mayar.id |
| `MAYAR_ENV` | `production` |
| `MAYAR_PRO_PRICE_IDR` | `49000` (var or default; not a secret) |
| `DATABASE_URL` | Already set (do not overwrite unless intentional) |
| `NEON_AUTH_COOKIE_SECRET` | Already set |

### Suggested commands

```bash
# From repo root. Do not commit the JSON file.
cat > /tmp/markx-mayar-prod-secrets.json <<'EOF'
{
  "MAYAR_API_KEY": "PASTE_PROD_KEY",
  "MAYAR_ENV": "production",
  "MAYAR_PRO_PRICE_IDR": "49000"
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

## 3. Activation — API-only, no webhook

Markx does **not** use Mayar webhooks. Pro activates via verify-on-read:
checkout stores the term's `transactionId`; entitlement reads re-fetch
`GET /transactions/{id}` (throttled 60s per user, forced from the success
page) and activate when Mayar confirms `paid`. Renewal/expiry is resolved
lazily the same way after `currentPeriodEnd`.

So there is nothing to register here — deliberately. The Mayar account's
single webhook URL slot stays free for other projects.

Verify production API access instead:

```bash
export MAYAR_API_KEY="PASTE_PROD_KEY"   # or: npx -y mayar@latest api-key …

npx -y mayar@latest whoami --json
# valid: true, production account that owns the Markx Pro product
```

- [ ] `whoami` valid on **production**, on the account that owns Markx Pro  
- [ ] Product + tier IDs from the same account (mismatched accounts 404)  

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
- [ ] DB: `user_subscriptions` row `plan=pro`, `status=active`, `mayar_transaction_id` set  
- [ ] DB: `mayar_processed_transactions` has the paid `transaction_id`  
- [ ] Repeated entitlement reads do **not** error and do not double-charge entitlements  

Optional hardening after first pay:

- [ ] Cancel or wait for expire in Mayar → next read after period end → plan returns to `free`  
- [ ] User with >100 entities while free: save rejected + upgrade CTA  

---

## 6. Rollback (if something breaks)

- [ ] Set Worker `MAYAR_ENV=sandbox` **or** remove/rotate bad prod key and redeploy  
- [ ] Or temporarily disable Upgrade CTA in a hotfix  
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

- [ ] Monitor Worker logs for Mayar re-check errors for 24–48h  
- [ ] Watch Mayar rate-limit headers; the 60s per-user throttle should keep reads well under 50 req/min  
- [ ] Confirm no sandbox keys remain in production Worker secrets  
- [ ] Local `.dev.vars` stays **sandbox** + `APP_URL=http://localhost:3000`  
- [ ] Document prod product/tier IDs in team password manager (not git)  

---

## Quick reference

| Item | Value |
|------|--------|
| App | `https://markx.app` |
| Success | `https://markx.app/subscription/success` |
| Activation | Verify-on-read (`GET /transactions/{id}`), no webhook |
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
| Checkout + entitlements + activation | `src/lib/server/subscription.ts` / `subscription.server.ts` |
| Success UI | `src/routes/subscription/success.tsx` |
| Upgrade CTA | `src/components/markx/account-menu.tsx` |
| Entity limit | `src/lib/markx/entity-count.ts` + `workspace.server.ts` |
| Local bootstrap | `bun run mayar:bootstrap` / `scripts/mayar-bootstrap.mjs` |

---

## Sign-off

| Role | Name | Date | Notes |
|------|------|------|-------|
| Eng | | | Secrets + deploy |
| Eng | | | First live pay |
| Owner | | | Prod product/price OK |

**Cutover complete when:** first real payment shows Pro on markx.app via verify-on-read, and rollback path is understood.
