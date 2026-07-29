export type MayarConfig = {
  apiKey: string
  baseUrl: string
  appUrl: string
  productId: string
  tierId: string
}

type MayarEnvBindings = {
  MAYAR_API_KEY?: string
  MAYAR_ENV?: string
  APP_URL?: string
  MAYAR_MEMBERSHIP_PRODUCT_ID?: string
  MAYAR_MEMBERSHIP_TIER_ID?: string
}

export async function getMayarConfig(): Promise<MayarConfig> {
  const { env } = await import("cloudflare:workers")
  const bindings = env as MayarEnvBindings

  const apiKey = bindings.MAYAR_API_KEY?.trim()
  const productId = bindings.MAYAR_MEMBERSHIP_PRODUCT_ID?.trim()
  const tierId = bindings.MAYAR_MEMBERSHIP_TIER_ID?.trim()
  const appUrl = bindings.APP_URL?.trim().replace(/\/$/, "")

  if (!apiKey) {
    throw new Error("MAYAR_API_KEY is not configured")
  }
  if (!productId || !tierId) {
    throw new Error(
      "MAYAR_MEMBERSHIP_PRODUCT_ID and MAYAR_MEMBERSHIP_TIER_ID are required"
    )
  }
  if (!appUrl) {
    throw new Error("APP_URL is not configured")
  }

  const baseUrl =
    bindings.MAYAR_ENV === "production"
      ? "https://api.mayar.id/hl/v2"
      : "https://api.mayar.club/hl/v2"

  return { apiKey, baseUrl, appUrl, productId, tierId }
}
