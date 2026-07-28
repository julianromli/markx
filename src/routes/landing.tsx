import { createFileRoute } from "@tanstack/react-router"

import { LandingHero } from "@/components/landing/hero"
import { LandingNavbar } from "@/components/landing/navbar"

import "@/components/landing/landing.css"

export const Route = createFileRoute("/landing")({
  head: () => ({
    meta: [{ title: "AFFiNE-style Landing (clone study)" }],
  }),
  component: LandingPage,
})

function LandingPage() {
  return (
    <div className="affine-landing">
      <LandingNavbar />
      <main>
        <LandingHero />
      </main>
    </div>
  )
}
