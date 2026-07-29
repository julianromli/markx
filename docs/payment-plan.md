# Plan: Integrasi Mayar — Markx

Status: **disetujui** (interview selesai). Implementasi mengikuti urutan di bawah.

## Konteks

Markx (TanStack Start + Cloudflare Workers) menjual **langganan membership bulanan Rp 49.000** via Mayar.

| Keputusan | Pilihan |
|-----------|---------|
| Model jualan | Membership / langganan (bulanan) |
| CTA | Account menu / header — **Upgrade to Pro** |
| Pricing page | Tidak perlu (satu plan, langsung checkout) |
| Post-payment | Redirect ke `/subscription/success` |
| Fulfillment | Free: ≤100 entitas di state; Pro: >100 |
| Entitas | **Total entitas di `MarkxState`** (folders, bookmarks, notes, image cards, dll.) |
| State di app | **D** — Postgres sumber kebenaran; UI di-hydrate saat login/load workspace |
| Harga | **Rp 49.000 IDR/bulan** (diatur di produk Mayar) |
| Environment awal | Sandbox (`api.mayar.club`) |

## Schema API Mayar

| Endpoint | Dipakai untuk |
|----------|----------------|
| `POST /memberships/members/create` | `productId`, `membershipTierId`, `customerInfo` (name, email, mobile), `membershipMonthlyPeriod: 1` → `memberId` |
| `POST /memberships/members/{memberId}/invoice/create` | `productId` → `membershipBillUrl`, `transactionId` |
| `GET /transactions/{id}` | Verifikasi webhook — bukti `paid`, bukan payload saja |
| `GET /memberships/members/{memberId}?productId=` | Re-sync status (`active` / `inactive`, `expiredAt`) di success page atau maintenance |

**Setup sekali di dashboard Mayar (sandbox):** buat produk membership SaaS **Rp 49.000/bulan** → simpan ID di env.

## Arsitektur di repo

- **Checkout:** `createServerFn` + `authMiddleware` (user sudah login; email dari session).
- **Webhook:** file route publik `src/routes/api/webhooks/mayar.ts` (untuk `mayar webhook register`).
- **Mayar helper:** `src/lib/mayar.ts` — baca env dari Cloudflare Workers (`getEnv()` / binding), bukan expose ke client.

## File yang dibuat

| File | Tujuan |
|------|--------|
| `src/lib/mayar.ts` | `mayarFetch`, register member, create invoice, get transaction/member |
| `src/lib/markx/entity-count.ts` | Hitung total entitas di state |
| `src/lib/server/subscription.server.ts` | DB subscription + dedupe webhook |
| `src/lib/server/subscription.ts` | Server fns: checkout, `getEntitlements` |
| `src/routes/api/webhooks/mayar.ts` | Webhook + provisioning |
| `src/routes/subscription.success.tsx` | Halaman setelah `redirectUrl` |
| Drizzle migration | `user_subscriptions`, `mayar_processed_transactions` |

## File yang diubah

| File | Perubahan |
|------|-----------|
| `src/lib/db/schema.ts` | Tabel subscription + processed transactions |
| `src/lib/server/workspace.server.ts` | Enforce limit entitas + kebijakan expire |
| `src/lib/server/workspace.ts` | Entitlements di snapshot load |
| `src/components/markx/account-menu.tsx` | Upgrade + status plan |
| `.env.example` | Var Mayar (tanpa secret) |
| Wrangler secrets / `.dev.vars` | `MAYAR_API_KEY` |

## Env var

| Variable | Keterangan |
|----------|------------|
| `MAYAR_BILLING_ENABLED` | Worker **var** feature flag (`true`/`false`). Default `false` — no limits/checkout until flipped |
| `MAYAR_API_KEY` | Server only — sandbox atau production |
| `MAYAR_ENV` | `sandbox` \| `production` |
| `APP_URL` | Base URL untuk `redirectUrl` (prod: `https://markx.app`) |
| `MAYAR_MEMBERSHIP_PRODUCT_ID` | UUID produk membership Markx Pro |
| `MAYAR_MEMBERSHIP_TIER_ID` | UUID tier bulanan Rp 49.000 |

## Fulfillment (webhook)

Setelah event relevan + **`GET /transactions/{id}`** status paid / success / settled:

1. Cocokkan user: email customer Mayar ↔ Neon Auth `user.email`.
2. Upsert `user_subscriptions`: `plan = 'pro'`, `status = 'active'`, `mayarMemberId`, `currentPeriodEnd` (dari member detail jika ada).
3. **Idempotent:** insert `transactionId` ke `mayar_processed_transactions` dengan `onConflictDoNothing`; duplikat webhook tidak double-fulfill.

Handler webhook:

```ts
// TODO: ganti verify-by-fetch dengan signature verification saat Mayar merilis HMAC webhook.
```

## Limit 100 (free)

- `FREE_TIER_ENTITY_LIMIT = 100`
- Jika `plan !== 'pro'` dan `countState(state) > 100` → **tolak save** (import/overwrite ikut aturan yang sama).
- Client menampilkan pesan + arahkan ke Upgrade.

## Langganan habis (expire / inactive) dengan >100 entitas

**Disetujui:**

- **Boleh baca / sync down**
- **Save ditolak** sampai entitas ≤ 100 **atau** user subscribe lagi
- **Tidak ada silent delete**

Implementasi: pada save, jika `plan !== 'pro'` dan count > 100, reject meskipun count tidak naik (user sudah di atas limit).

## Checkout flow

1. User klik **Upgrade** di account menu.
2. Server: register member (atau pakai member existing) → `invoice/create` → kembalikan `membershipBillUrl`.
3. `redirectUrl`: `${APP_URL}/subscription/success`
4. Success page: refresh entitlements (server fn), pesan singkat, kembali ke workspace.

**Mobile:** Mayar membutuhkan `mobile` (10–15 digit). Saat implement: field opsional di dialog upgrade atau nomor placeholder yang bisa diganti user — pilih UX minimal yang tidak gagal validasi Mayar.

## Urutan implementasi

1. Produk membership Rp 49.000 di Mayar sandbox + catat product/tier ID
2. Migration + `entity-count` + `mayar.ts`
3. `subscription.server.ts` + server fns
4. Enforce limit di `workspace.server.ts`
5. Account menu + `/subscription/success`
6. Webhook + re-fetch + provisioning
7. `npx -y mayar@latest --sandbox webhook register <url>` + uji E2E sandbox

## Go-live checklist

Checklist lengkap (secrets, webhook, deploy, bukti bayar, rollback):
**[mayar-production-cutover.md](./mayar-production-cutover.md)**

Ringkas:

- [ ] Ganti `MAYAR_API_KEY` + `MAYAR_ENV=production`
- [ ] Product/tier ID production di env
- [ ] `APP_URL=https://markx.app`
- [ ] Register webhook URL production (`https://markx.app/api/webhooks/mayar`)
- [ ] Tier redirect → `https://markx.app/subscription/success`
- [ ] Satu transaksi kecil nyata
- [ ] Pantau `mayar webhook history`
