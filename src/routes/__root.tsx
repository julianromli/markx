import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"

import { Toaster } from "@/components/ui/sonner"
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site-meta"
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
        title: SITE_NAME,
      },
      {
        name: "description",
        content: SITE_DESCRIPTION,
      },
      {
        name: "theme-color",
        content: "#000000",
      },
      {
        property: "og:type",
        content: "website",
      },
      {
        property: "og:site_name",
        content: SITE_NAME,
      },
      {
        property: "og:title",
        content: SITE_NAME,
      },
      {
        property: "og:description",
        content: SITE_DESCRIPTION,
      },
      {
        property: "og:url",
        content: SITE_URL,
      },
      {
        property: "og:image",
        content: `${SITE_URL}/og.png`,
      },
      {
        name: "twitter:card",
        content: "summary_large_image",
      },
      {
        name: "twitter:title",
        content: SITE_NAME,
      },
      {
        name: "twitter:description",
        content: SITE_DESCRIPTION,
      },
      {
        name: "twitter:image",
        content: `${SITE_URL}/og.png`,
      },
    ],
    links: [
      {
        rel: "canonical",
        href: SITE_URL,
      },
      {
        rel: "icon",
        href: "/favicon.ico",
        sizes: "any",
      },
      {
        rel: "icon",
        href: "/favicon-markx.png",
        type: "image/png",
        sizes: "64x64",
      },
      {
        rel: "apple-touch-icon",
        href: "/favicon-markx.png",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
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
        {children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  )
}
