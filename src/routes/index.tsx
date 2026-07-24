import { createFileRoute } from "@tanstack/react-router"

import { Workspace } from "@/components/markx/workspace"

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () => ({
    meta: [{ title: "markx" }],
  }),
})

function HomePage() {
  return <Workspace mode="home" />
}
