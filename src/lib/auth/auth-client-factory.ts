import { emailOTPClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

export function buildAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    fetchOptions: { credentials: "include" },
    plugins: [emailOTPClient()],
  })
}
