import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"

import { Toaster } from "@/components/ui/sonner"
import { MarkxProvider } from "@/lib/markx/store"
import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "markx",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <MarkxProvider>
          {children}
          <Toaster />
        </MarkxProvider>
        <Scripts />
      </body>
    </html>
  )
}
