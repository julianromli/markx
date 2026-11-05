export function isAuthPath(pathname: string): boolean {
  return pathname.startsWith("/api/auth/")
}

/** Better Auth endpoint that triggers an OTP email send. */
export function isEmailOtpSendPath(pathname: string): boolean {
  return pathname === "/api/auth/email-otp/send-verification-otp"
}
