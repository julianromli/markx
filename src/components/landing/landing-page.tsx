import { Link } from "@tanstack/react-router"
import { ArrowRightIcon, LinkIcon } from "@phosphor-icons/react"

import homeIcon from "@/assets/markx/header/home.svg"
import pixelFolder from "@/assets/markx/pixel-folder.svg"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const FAQS = [
  {
    question: "What is markx?",
    answer:
      "markx is a spatial bookmark board: a visual bookmark manager where your links, notes, images, and folders live on an infinite canvas instead of a list. You place everything where it makes sense to you.",
  },
  {
    question: "Is markx free?",
    answer:
      "Yes. You can start a board right now for free, no account needed. Signing in unlocks cloud sync, so your board follows you across devices.",
  },
  {
    question: "Do I need an account to use it?",
    answer:
      "No. markx works instantly in guest mode and saves your board in your browser. Create an account when you want it synced and backed up.",
  },
  {
    question: "How is markx different from a regular bookmark manager?",
    answer:
      "Most bookmark managers file your saves into lists. markx gives you a canvas instead. You decide where everything goes, so your spatial memory does the finding for you.",
  },
  {
    question: "What can I put on a board?",
    answer:
      "Bookmarks with automatic previews, sticky notes, images, and folders. Folders open into their own boards, so you can nest as deep as you like.",
  },
]

const FEATURES = [
  {
    image: "/features/markx-feature-cards.webp",
    alt: "3D render of a bookmark card with a globe, a chain link, and a video player floating around it",
    title: "Bookmarks with real previews",
    description:
      "Paste any URL and markx builds a rich card with its title and preview image, so your board stays scannable at a glance.",
  },
  {
    image: "/features/markx-feature-notes.webp",
    alt: "3D render of sticky notes floating at slight angles, one pinned by a pushpin",
    title: "Sticky notes, your way",
    description:
      "Jot thoughts right where they belong, in colors that actually mean something to you.",
  },
  {
    image: "/features/markx-feature-moodboard.webp",
    alt: "3D render of photo prints scattered like a moodboard, with a picture frame and a paper clip",
    title: "A moodboard for anything",
    description:
      "Drop or paste images straight onto the canvas: inspiration, references, screenshots, anything visual.",
  },
  {
    image: "/features/markx-feature-folders.webp",
    alt: "3D render of an open folder with cards emerging from it under a magnifying glass",
    title: "Boards inside boards",
    description:
      "Group items into folders and zoom in. Every folder is its own infinite canvas, nested as deep as you like.",
  },
]

export function LandingPage() {
  return (
    <div className="min-h-svh bg-white text-[#202020]">
      <LandingHeader />
      <main>
        <HeroSection />
        <FeaturesSection />
        <FaqSection />
      </main>
      <LandingFooter />
    </div>
  )
}

function LandingHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link
          to="/"
          className="flex items-center gap-2"
          aria-label="markx home"
        >
          <img
            src={homeIcon}
            alt=""
            className="size-6 drop-shadow-[0_1px_1px_rgba(51,61,78,0.3)]"
          />
          <span className="text-[17px] font-semibold tracking-tight">
            markx
          </span>
        </Link>
        <nav className="flex items-center gap-5" aria-label="Main">
          <a
            href="#features"
            className="hidden text-sm text-black/60 transition-colors hover:text-black sm:inline"
          >
            Features
          </a>
          <a
            href="#faq"
            className="hidden text-sm text-black/60 transition-colors hover:text-black sm:inline"
          >
            FAQ
          </a>
          <Link
            to="/app"
            className="hidden text-sm text-black/60 transition-colors hover:text-black sm:inline"
          >
            Sign in
          </Link>
          <Link to="/app" className={buttonVariants({ size: "sm" })}>
            Open app
          </Link>
        </nav>
      </div>
    </header>
  )
}

function HeroSection() {
  return (
    <section className="markx-dot-bg relative flex min-h-svh items-center justify-center overflow-hidden px-5">
      {/* Decorative board items — pure ornament, the real copy is the text below. */}
      <div aria-hidden="true" className="absolute inset-0">
        <div className="animate-float absolute top-[15%] left-[4%] w-40 -rotate-6 sm:left-[7%] sm:w-52">
          <BookmarkMock />
        </div>
        <div className="animate-float-delayed absolute top-[13%] right-[5%] w-28 rotate-3 sm:right-[8%] sm:w-36">
          <NoteMock color="#fef08a" lines={3} />
        </div>
        <div className="animate-float absolute bottom-[13%] left-[9%] hidden w-44 rotate-2 md:block">
          <ImageMock />
        </div>
        <div className="animate-float-delayed absolute right-[6%] bottom-[15%] hidden w-20 -rotate-3 sm:block sm:w-28">
          <FolderMock />
        </div>
        <div className="animate-float absolute top-[55%] left-[22%] hidden w-24 rotate-6 lg:block">
          <NoteMock color="#fbcfe8" lines={2} />
        </div>
        <div className="animate-float-delayed absolute top-[8%] right-[24%] hidden w-24 -rotate-2 lg:block">
          <MiniLinkMock />
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-2xl text-center">
        <h1 className="text-5xl font-semibold tracking-tight sm:text-7xl">
          Your Saves
          <br />
          Deserve Space
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-pretty text-black/60 sm:text-lg">
          Drop links, notes, images, and folders onto an infinite canvas.
          Arrange them your way.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/app"
            className={cn(buttonVariants(), "h-12 gap-2 px-7 text-[15px]")}
          >
            Start your board
            <ArrowRightIcon
              weight="bold"
              className="size-4 transition-transform group-hover/button:translate-x-0.5"
            />
          </Link>
          <a
            href="#features"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-12 px-7 text-[15px]"
            )}
          >
            Explore features
          </a>
        </div>
        <p className="mt-4 text-xs text-black/45">
          Free · No account needed · Your board saves in your browser
        </p>
      </div>
    </section>
  )
}

function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Everything you save, in one place
          </h2>
          <p className="mt-4 text-black/60">
            Four building blocks, one infinite canvas.
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="group overflow-hidden rounded-2xl border border-black/10 bg-white transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06),0_12px_32px_rgba(0,0,0,0.06)]"
            >
              <div className="overflow-hidden bg-[#f1f1f1]">
                <img
                  src={feature.image}
                  alt={feature.alt}
                  width={1120}
                  height={747}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[3/2] w-full object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.03]"
                />
              </div>
              <div className="p-6">
                <h3 className="text-[15px] font-semibold sm:text-base">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-black/60">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FaqSection() {
  return (
    <section
      id="faq"
      className="scroll-mt-16 border-t border-black/5 bg-[#fafafa] py-20 sm:py-28"
    >
      <div className="mx-auto max-w-3xl px-5">
        <h2 className="text-center text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Frequently asked questions
        </h2>
        <div className="mt-12 divide-y divide-black/8">
          {FAQS.map((faq) => (
            <div key={faq.question} className="py-6 first:pt-0 last:pb-0">
              <h3 className="text-[15px] font-semibold">{faq.question}</h3>
              <p className="mt-2 text-sm leading-relaxed text-black/60">
                {faq.answer}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function LandingFooter() {
  return (
    <footer className="border-t border-black/10 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-10 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <img
              src={homeIcon}
              alt=""
              className="size-5 drop-shadow-[0_1px_1px_rgba(51,61,78,0.3)]"
            />
            <span className="text-[15px] font-semibold tracking-tight">
              markx
            </span>
          </div>
          <p className="mt-2 text-sm text-black/50">
            A spatial board for everything you save.
          </p>
        </div>
        <nav className="flex items-center gap-5" aria-label="Footer">
          <Link
            to="/app"
            className="text-sm text-black/60 transition-colors hover:text-black"
          >
            Open app
          </Link>
          <a
            href="#features"
            className="text-sm text-black/60 transition-colors hover:text-black"
          >
            Features
          </a>
          <a
            href="#faq"
            className="text-sm text-black/60 transition-colors hover:text-black"
          >
            FAQ
          </a>
        </nav>
      </div>
      <div className="border-t border-black/5">
        <p className="mx-auto max-w-6xl px-5 py-4 text-xs text-black/40">
          © 2026 markx
        </p>
      </div>
    </footer>
  )
}

/* -------------------------------------------------------------------------- */
/* Decorative board-item mocks                                                 */
/* -------------------------------------------------------------------------- */

const MOCK_CARD_SHADOW =
  "shadow-[3px_3px_8px_rgba(0,0,0,0.1),11px_10px_15px_rgba(0,0,0,0.09),24px_24px_20px_rgba(0,0,0,0.05)]"

function BookmarkMock() {
  return (
    <div
      className={`rounded-[25px] border-[3px] border-white/50 bg-white p-4 ${MOCK_CARD_SHADOW}`}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.06]">
          <LinkIcon className="size-4 text-black/50" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="h-2 w-3/4 rounded-full bg-black/15" />
          <div className="h-1.5 w-1/2 rounded-full bg-black/8" />
        </div>
      </div>
      <div className="mt-3 h-14 rounded-xl bg-black/[0.06]" />
      <div className="mt-3 h-5 rounded-full bg-black/[0.05] px-2.5 py-1">
        <div className="h-1.5 w-2/5 rounded-full bg-black/10" />
      </div>
    </div>
  )
}

function MiniLinkMock() {
  return (
    <div
      className={`flex items-center gap-2 rounded-2xl border-[3px] border-white/50 bg-white p-2.5 ${MOCK_CARD_SHADOW}`}
    >
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-black/[0.06]">
        <LinkIcon className="size-3 text-black/50" />
      </div>
      <div className="h-1.5 w-12 rounded-full bg-black/15" />
    </div>
  )
}

function NoteMock({ color, lines }: { color: string; lines: number }) {
  return (
    <div
      className="rounded-[12px] p-3.5 shadow-[3px_3px_8px_rgba(0,0,0,0.08),11px_10px_15px_rgba(0,0,0,0.06)]"
      style={{ backgroundColor: color }}
    >
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-1.5 rounded-full bg-black/15"
            style={{ width: i === lines - 1 ? "55%" : "100%" }}
          />
        ))}
      </div>
    </div>
  )
}

function ImageMock() {
  return (
    <div
      className={`rounded-[20px] border-[3px] border-white/50 bg-white p-2.5 ${MOCK_CARD_SHADOW}`}
    >
      <svg
        viewBox="0 0 176 110"
        className="block h-auto w-full rounded-[12px]"
        role="presentation"
      >
        <rect width="176" height="110" fill="#dbeafe" />
        <circle cx="132" cy="28" r="13" fill="#fcd34d" />
        <polygon points="0,110 62,44 118,110" fill="#93a8c4" />
        <polygon points="72,110 128,58 176,110" fill="#6b87ab" />
      </svg>
    </div>
  )
}

function FolderMock() {
  return (
    <div className="flex flex-col items-center">
      <img src={pixelFolder} alt="" className="w-full drop-shadow-md" />
      <div className="mt-2 h-2 w-3/5 rounded-full bg-black/15" />
    </div>
  )
}
