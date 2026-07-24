import { createFileRoute } from "@tanstack/react-router"

import { Workspace } from "@/components/markx/workspace"

export const Route = createFileRoute("/folder/$folderId")({
  component: FolderPage,
  head: () => ({
    meta: [{ title: "markx" }],
  }),
})

function FolderPage() {
  const { folderId } = Route.useParams()
  return <Workspace mode="folder" folderId={folderId} />
}
