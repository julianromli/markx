/**
 * Stub for Vitest. The real `cloudflare:workers` module is only available
 * inside the Workers runtime / Cloudflare Vite plugin SSR environment.
 */
export const env = new Proxy(
  {},
  {
    get() {
      throw new Error(
        "cloudflare:workers env is unavailable in the Vitest environment"
      )
    },
  }
)
