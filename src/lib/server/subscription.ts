import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import { authMiddleware, requireUser } from "@/lib/auth/middleware"
import {
  getEntitlementsForUser,
  refreshSubscriptionFromMayar,
  startProCheckout as startProCheckoutSession,
} from "@/lib/server/subscription.server"
import type {
  ProCheckoutSession,
  UserEntitlements,
} from "@/lib/server/subscription.server"

export type { ProCheckoutSession, UserEntitlements }

const checkoutSchema = z.object({
  mobile: z.string().trim().min(10).max(20),
  name: z.string().trim().max(250).optional(),
})

export const getEntitlements = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<UserEntitlements> => {
    const user = requireUser(context)
    return getEntitlementsForUser(user.id)
  })

export const refreshEntitlements = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<UserEntitlements> => {
    const user = requireUser(context)
    return refreshSubscriptionFromMayar(user.id)
  })

export const startProCheckout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(checkoutSchema)
  .handler(async ({ data, context }): Promise<ProCheckoutSession> => {
    const user = requireUser(context)
    return startProCheckoutSession({
      userId: user.id,
      email: user.email,
      name: data.name ?? user.email,
      mobile: data.mobile,
    })
  })
