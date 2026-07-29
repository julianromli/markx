#!/usr/bin/env node
/**
 * Discover Markx Pro membership product/tier IDs in Mayar sandbox and
 * patch .dev.vars. Membership SaaS must exist in the dashboard first.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const devVarsPath = resolve(root, ".dev.vars")

function parseDevVars(contents) {
  const vars = {}
  for (const line of contents.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) vars[key] = value
  }
  return vars
}

function upsertDevVar(contents, key, value) {
  const line = `${key}="${value}"`
  const re = new RegExp(`^${key}=.*$`, "m")
  if (re.test(contents)) {
    return contents.replace(re, line)
  }
  return `${contents.replace(/\s*$/, "")}\n${line}\n`
}

async function mayarGet(apiKey, path) {
  const res = await fetch(`https://api.mayar.club/hl/v2${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const body = await res.json()
  if (!res.ok || (body.statusCode ?? 500) >= 400) {
    throw new Error(body.messages ?? body.message ?? res.statusText)
  }
  return body.data
}

async function findMembershipProduct(apiKey) {
  const products = await mayarGet(apiKey, "/products?limit=50")
  for (const product of products) {
    const tiers = product.membershipTier ?? []
    if (tiers.length > 0) {
      return { productId: product.id, productName: product.name, tiers }
    }
    if (product.type && String(product.type).toLowerCase().includes("membership")) {
      const tierList = await mayarGet(
        apiKey,
        `/memberships/tiers?productId=${encodeURIComponent(product.id)}&limit=20`
      )
      if (tierList?.length) {
        return {
          productId: product.id,
          productName: product.name,
          tiers: tierList,
        }
      }
    }
  }

  for (const product of products) {
    try {
      const tierList = await mayarGet(
        apiKey,
        `/memberships/tiers?productId=${encodeURIComponent(product.id)}&limit=20`
      )
      if (tierList?.length) {
        return {
          productId: product.id,
          productName: product.name,
          tiers: tierList,
        }
      }
    } catch {
      // not a membership product
    }
  }

  return null
}

function pickTier(tiers) {
  const markx = tiers.find((t) =>
    /markx/i.test(t.name ?? "")
  )
  if (markx) return markx
  const active = tiers.find((t) => t.status === "ACTIVE")
  return active ?? tiers[0]
}

async function main() {
  if (!existsSync(devVarsPath)) {
    console.error("Missing .dev.vars")
    process.exit(1)
  }

  let contents = readFileSync(devVarsPath, "utf8")
  const vars = parseDevVars(contents)
  const apiKey = vars.MAYAR_API_KEY
  if (!apiKey) {
    console.error("MAYAR_API_KEY missing in .dev.vars")
    process.exit(1)
  }

  const probe = await fetch("https://api.mayar.club/hl/v2/products?limit=1", {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!probe.ok) {
    console.error("Sandbox API key invalid or expired")
    process.exit(1)
  }

  contents = upsertDevVar(contents, "MAYAR_ENV", "sandbox")
  contents = upsertDevVar(contents, "APP_URL", vars.APP_URL || "http://localhost:3000")

  const found = await findMembershipProduct(apiKey)
  if (!found) {
    writeFileSync(devVarsPath, contents)
    console.log(`
Belum ada produk Membership di sandbox.

Buat manual (±2 menit):
1. Buka https://web.mayar.club → Product → Create → Membership & SaaS
2. Nama: Markx Pro
3. Create tier: harga 1 bulan = Rp 49.000
4. Redirect URL tier: http://localhost:3000/subscription/success
5. Publish produk

Lalu jalankan lagi: node scripts/mayar-bootstrap.mjs
`)
    process.exit(2)
  }

  const tier = pickTier(found.tiers)
  contents = upsertDevVar(contents, "MAYAR_MEMBERSHIP_PRODUCT_ID", found.productId)
  contents = upsertDevVar(contents, "MAYAR_MEMBERSHIP_TIER_ID", tier.id)
  writeFileSync(devVarsPath, contents)

  console.log("OK — .dev.vars updated")
  console.log(`  Product: ${found.productName} (${found.productId})`)
  console.log(`  Tier: ${tier.name} (${tier.id})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
