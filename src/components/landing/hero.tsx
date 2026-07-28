import { useEffect, useRef, useState } from "react"

/** Filled checkbox with checkmark (brand blue). */
function CheckedIcon() {
  return (
    <svg viewBox="0 0 65 65" fill="none" className="icon-checked" aria-hidden="true">
      <path
        d="M0 10.8333C0 4.85025 4.85025 0 10.8333 0H54.1667C60.1498 0 65 4.85025 65 10.8333V54.1667C65 60.1498 60.1497 65 54.1667 65H10.8333C4.85025 65 0 60.1497 0 54.1667V10.8333ZM50.3468 22.771C51.5006 21.6172 51.5006 19.7465 50.3468 18.5926C49.1929 17.4388 47.3222 17.4388 46.1684 18.5926L26.5909 38.1701L20.8013 32.3805C19.6475 31.2267 17.7768 31.2267 16.6229 32.3805C15.4691 33.5343 15.4691 35.4051 16.6229 36.5589L24.5017 44.4377C25.6556 45.5915 27.5263 45.5915 28.6801 44.4377L50.3468 22.771Z"
        fill="#1E96EB"
      />
    </svg>
  )
}

/** Outlined empty checkbox (brand blue stroke). */
function UncheckedIcon() {
  return (
    <svg viewBox="0 0 65 65" fill="none" className="icon-unchecked" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M54 6H11C8.23858 6 6 8.23858 6 11V54C6 56.7614 8.23858 59 11 59H54C56.7614 59 59 56.7614 59 54V11C59 8.23858 56.7614 6 54 6ZM11 0C4.92487 0 0 4.92487 0 11V54C0 60.0751 4.92487 65 11 65H54C60.0751 65 65 60.0751 65 54V11C65 4.92487 60.0751 0 54 0H11Z"
        fill="#1E96EB"
      />
    </svg>
  )
}

/** Lazy-loads + plays the hero video only when it enters the viewport. */
function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!video.src) video.src = "/landing/hero-cover.mp4"
            void video.play().catch(() => {})
          } else {
            video.pause()
          }
        }
      },
      { threshold: 0.1 },
    )
    io.observe(video)
    return () => io.disconnect()
  }, [])

  return (
    <video
      ref={ref}
      poster="/landing/hero-cover.png"
      preload="none"
      aria-hidden="true"
      loop
      muted
      playsInline
    />
  )
}

export function LandingHero() {
  const [checked, setChecked] = useState(true)

  return (
    <section className="af-hero">
      {/* pinned headline */}
      <div className="af-pin-wrapper">
        <div className="af-text-wrapper">
          <h1 className="af-hero-title af-animated-in af-delay-50">
            <span className="af-title-row block">
              <span className="af-write-word">
                <span className="af-symbol-cursor" />
                Write,
              </span>
              <span className="af-draw-word">Draw,</span>
              <span className="af-draw-plan">
                <button
                  type="button"
                  className={`af-big-checkbox ${checked ? "is-checked" : ""}`}
                  aria-label={checked ? "Uncheck plan" : "Check plan"}
                  aria-pressed={checked}
                  onClick={() => setChecked((v) => !v)}
                >
                  <CheckedIcon />
                  <UncheckedIcon />
                </button>
                Plan,
              </span>
            </span>
            <span className="af-title-row-2 block">
              All at Once.
              <span className="af-small-text">
                {" With "}
                <span className="af-color-brand">AI.</span>
              </span>
            </span>
          </h1>
          <p className="af-hero-desc af-animated-in af-delay-100">
            AFFiNE is a workspace with fully merged docs, whiteboards and
            databases.{"\n"}Get more things done, your creativity isn’t
            monotone.
          </p>
          <a
            href="https://app.affine.pro"
            target="_blank"
            rel="noopener noreferrer"
            className="af-hero-cta af-hero-cta-desktop"
          >
            <span className="af-btn af-btn-hero">Get Started</span>
          </a>
          <a href="https://affine.pro/download" className="af-hero-cta af-hero-cta-mobile">
            <span className="af-btn af-btn-hero">Get the App</span>
          </a>
        </div>
      </div>

      {/* scroll room + cover card */}
      <div className="af-hero-container">
        <div className="af-pin-space" />
        <div className="af-hero-cover">
          <HeroVideo />
        </div>
        <div className="af-bottom-gap" />
      </div>

      {/* Product Hunt badge — fixed bottom-right, hidden on mobile */}
      <a
        href="https://www.producthunt.com/posts/affine-ai"
        target="_blank"
        rel="noopener noreferrer"
        className="af-ph-badge"
      >
        <img
          src="https://api.producthunt.com/widgets/embed-image/v1/top-post-badge.svg?post_id=453897&theme=light&period=daily"
          alt="AFFiNE AI on Product Hunt"
          width="250"
          height="54"
        />
      </a>
    </section>
  )
}
