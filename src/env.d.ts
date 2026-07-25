interface ViteTypeOptions {
  strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
  readonly VITE_NEON_AUTH_URL?: string
}

declare namespace Cloudflare {
  interface Env {
    DATABASE_URL?: string
  }
}
