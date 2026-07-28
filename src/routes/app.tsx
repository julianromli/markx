import { createFileRoute } from "@tanstack/react-router"

import { Workspace } from "@/components/markx/workspace"

export const Route = createFileRoute("/app")({
  component: AppPage,
  head: () => ({
    meta: [
      {
        name: "robots",
        content: "noindex",
      },
    ],
  }),
})

function AppPage() {
  return <Workspace mode="home" />
}
