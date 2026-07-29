interface ViteTypeOptions {
  strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
  readonly VITE_NEON_AUTH_URL?: string
}

declare namespace Cloudflare {
  interface Env {
    DATABASE_URL?: string
    /** "true" | "false" — Pro limits + Mayar checkout. Default false in wrangler vars. */
    MAYAR_BILLING_ENABLED?: string
    MAYAR_API_KEY?: string
    MAYAR_ENV?: string
    APP_URL?: string
    MAYAR_MEMBERSHIP_PRODUCT_ID?: string
    MAYAR_MEMBERSHIP_TIER_ID?: string
  }
}
