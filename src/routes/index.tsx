import { createFileRoute } from "@tanstack/react-router"

import { FAQS, LandingPage } from "@/components/landing/landing-page"
import {
  LANDING_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site-meta"

const webAppJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_URL,
  description: LANDING_DESCRIPTION,
  applicationCategory: "ProductivityApplication",
  operatingSystem: "Any",
  image: `${SITE_URL}/og.png`,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
}

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
}

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    meta: [
      {
        title: SITE_TITLE,
      },
      {
        name: "description",
        content: LANDING_DESCRIPTION,
      },
      {
        property: "og:title",
        content: SITE_TITLE,
      },
      {
        property: "og:description",
        content: LANDING_DESCRIPTION,
      },
      {
        name: "twitter:title",
        content: SITE_TITLE,
      },
      {
        name: "twitter:description",
        content: LANDING_DESCRIPTION,
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(webAppJsonLd),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify(faqJsonLd),
      },
    ],
  }),
})
