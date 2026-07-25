/** User fields shared by browser session consumers and server auth. */
export type AuthUser = {
  id: string
  email: string
}

/** Additional claims available only after server-side JWT verification. */
export type VerifiedAuthUser = AuthUser & {
  emailVerified: boolean
}
