import {
  GithubLogo,
  List,
  Star,
  X,
} from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

import { AffineLogo, ArrowIcon } from "./affine-logo"
import {
  IconAI,
  IconCommunity,
  IconContactSales,
  IconDiscord,
  IconDocs,
  IconEdgeless,
  IconEnterprise,
  IconTeamhub,
  IconTwitterX,
} from "./nav-icons"

type SubItem = {
  name: string
  desc: string
  href: string
  icon: React.ReactNode
  ai?: boolean
}

const PRODUCT_ITEMS: SubItem[] = [
  {
    name: "AFFiNE AI",
    desc: "Create Smarter with AI",
    href: "https://affine.pro/ai",
    icon: <IconAI />,
    ai: true,
  },
  {
    name: "Docs",
    desc: "Powerful, Simple for All",
    href: "https://affine.pro/pagedoc",
    icon: <IconDocs />,
  },
  {
    name: "Edgeless",
    desc: "Collaborate Without Limits",
    href: "https://affine.pro/whiteboard",
    icon: <IconEdgeless />,
  },
]

const TEAM_ITEMS: SubItem[] = [
  {
    name: "Teamhub",
    desc: "Unified Team Document Space",
    href: "https://affine.pro/teamhub",
    icon: <IconTeamhub />,
  },
  {
    name: "Enterprise",
    desc: "Private cloud and self-hosted deployments",
    href: "https://affine.pro/enterprise",
    icon: <IconEnterprise />,
  },
  {
    name: "Contact sales",
    desc: "Seats, contracts and pilots — talk to us",
    href: "https://affine.pro/contact-sales",
    icon: <IconContactSales />,
  },
]

const RESOURCE_LINKS = [
  { name: "Docs", href: "https://docs.affine.pro/" },
  { name: "Templates", href: "https://affine.pro/templates" },
  { name: "About Us", href: "https://affine.pro/about-us" },
  { name: "Blog", href: "https://affine.pro/blog" },
  { name: "Timers", href: "https://affine.pro/timers" },
]

const COMMUNITY_ITEMS: SubItem[] = [
  {
    name: "Discord",
    desc: "Get tips and support from 7k+ users",
    href: "https://affine.pro/redirect/discord",
    icon: <IconDiscord />,
  },
  {
    name: "Twitter",
    desc: "Stay tuned for the latest news",
    href: "https://twitter.com/AffineOfficial",
    icon: <IconTwitterX />,
  },
  {
    name: "Community",
    desc: "Become an ambassador and track events",
    href: "https://community.affine.pro/",
    icon: <IconCommunity />,
  },
]

const LOCALES = [
  { label: "English", iso: "" },
  { label: "日本語", iso: "ja-JP" },
  { label: "한국어", iso: "ko-KR" },
  { label: "繁體中文", iso: "zh-TW" },
  { label: "Deutsch", iso: "de-DE" },
  { label: "Españoles", iso: "es-ES" },
  { label: "Français", iso: "fr-FR" },
  { label: "Português (Brasil)", iso: "pt-BR" },
  { label: "Italiano", iso: "it-IT" },
]

function SubItemLink({ item }: { item: SubItem }) {
  return (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      className={`af-nav-sub-item ${item.ai ? "item-ai" : ""}`}
    >
      <span className="sub-icon">{item.icon}</span>
      <span>
        <span className="af-sub-name block">{item.name}</span>
        <span className="af-sub-desc block">{item.desc}</span>
      </span>
    </a>
  )
}

/** Hover-driven mega menu (opens on pointer enter, closes on leave). */
function NavDropdown({
  label,
  children,
  wide,
}: {
  label: string
  children: React.ReactNode
  wide?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="af-nav-item relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={`af-nav-trigger ${open ? "is-open" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <span className="af-arrow-icon">
          <ArrowIcon />
        </span>
      </button>
      <div
        className={`af-popover ${open ? "is-open" : ""} ${
          wide ? "af-popover-wide" : "af-popover-col"
        }`}
        role="menu"
      >
        {children}
      </div>
    </div>
  )
}

function LanguageSwitcher() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState("English")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="af-lang-trigger"
        aria-label={`Switch language. Current: ${current}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current}</span>
        <span className="af-arrow-icon">
          <ArrowIcon />
        </span>
      </button>
      <div className={`af-lang-menu ${open ? "is-open" : ""}`} role="menu">
        {LOCALES.map((l) => (
          <button
            key={l.label}
            type="button"
            className={l.label === current ? "is-active" : ""}
            onClick={() => {
              setCurrent(l.label)
              setOpen(false)
            }}
          >
            <span>{l.label}</span>
            {l.iso && (
              <span className="ml-auto text-xs font-normal opacity-50">
                {l.iso}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function GithubStarsButton() {
  return (
    <a
      href="https://github.com/toeverything/AFFiNE"
      target="_blank"
      rel="nofollow noopener noreferrer"
      className="af-github-btn"
      aria-label="Stars on GitHub: 70K+"
    >
      <GithubLogo className="gh-icon" weight="fill" />
      <span className="stars-count">70K+</span>
      <Star className="star-icon" weight="fill" />
    </a>
  )
}

function useHasScrolled() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])
  return scrolled
}

function DesktopNavbar() {
  const scrolled = useHasScrolled()
  return (
    <div className="af-navbar">
      <div className="af-navbar-placeholder" />
      <div className={`af-navbar-bar ${scrolled ? "has-scroll" : ""}`}>
        <div className="af-navbar-inner">
          <nav className="af-menu-list" aria-label="Main">
            <a href="/landing" className="af-logo-handler" aria-label="Home">
              <AffineLogo />
            </a>
            <NavDropdown label="Product">
              {PRODUCT_ITEMS.map((item) => (
                <SubItemLink key={item.name} item={item} />
              ))}
            </NavDropdown>
            <NavDropdown label="Team">
              {TEAM_ITEMS.map((item) => (
                <SubItemLink key={item.name} item={item} />
              ))}
            </NavDropdown>
            <div className="af-nav-item">
              <a className="af-nav-link" href="https://affine.pro/download">
                Download
              </a>
            </div>
            <NavDropdown label="Resources" wide>
              <div className="af-popover-links">
                {RESOURCE_LINKS.map((l) => (
                  <a key={l.name} className="af-nav-link" href={l.href}>
                    {l.name}
                  </a>
                ))}
              </div>
              <div className="flex-1">
                <div className="af-static-link">Community</div>
                {COMMUNITY_ITEMS.map((item) => (
                  <SubItemLink key={item.name} item={item} />
                ))}
              </div>
            </NavDropdown>
            <div className="af-nav-item">
              <a className="af-nav-link" href="https://affine.pro/pricing">
                Pricing
              </a>
            </div>
          </nav>
          <div className="af-right-part">
            <LanguageSwitcher />
            <div>
              <a
                href="https://app.affine.pro"
                target="_blank"
                rel="noopener noreferrer"
                className="af-btn af-btn-nav"
              >
                Get Started
              </a>
              <div className="af-explore-caption">Explore on Desktop</div>
            </div>
            <GithubStarsButton />
          </div>
        </div>
      </div>
    </div>
  )
}

function MobileMenuSection({
  label,
  items,
  open,
  onToggle,
}: {
  label: string
  items: SubItem[]
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className={`af-m-item ${open ? "is-open" : ""}`}>
      <button type="button" className="af-m-row" onClick={onToggle}>
        {label}
        <span className="af-arrow-icon">
          <ArrowIcon />
        </span>
      </button>
      <div className="af-m-sub">
        {items.map((item) => (
          <SubItemLink key={item.name} item={item} />
        ))}
      </div>
    </div>
  )
}

function MobileNavbar() {
  const scrolled = useHasScrolled()
  const [menuOpen, setMenuOpen] = useState(false)
  const [section, setSection] = useState<string | null>(null)

  return (
    <div className="af-navbar-mobile">
      <div className="af-navbar-placeholder" />
      <div className={`af-mobile-bar ${scrolled ? "has-scroll" : ""}`}>
        <div className="af-mobile-row">
          <a href="/landing" className="af-logo-handler" aria-label="Home">
            <AffineLogo />
          </a>
          <div className="af-mobile-actions">
            <a
              href="https://app.affine.pro"
              target="_blank"
              rel="noopener noreferrer"
              className="af-btn af-btn-nav af-mobile-try"
            >
              Get Started
            </a>
            <button
              type="button"
              className="af-menu-icon"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X weight="bold" /> : <List weight="bold" />}
            </button>
          </div>
        </div>
        <div className={`af-collapsed-menu ${menuOpen ? "is-open" : ""}`}>
          <div className="af-collapsed-list">
            <MobileMenuSection
              label="Product"
              items={PRODUCT_ITEMS}
              open={section === "product"}
              onToggle={() =>
                setSection((s) => (s === "product" ? null : "product"))
              }
            />
            <MobileMenuSection
              label="Team"
              items={TEAM_ITEMS}
              open={section === "team"}
              onToggle={() => setSection((s) => (s === "team" ? null : "team"))}
            />
            <div className="af-m-item">
              <a className="af-m-row" href="https://affine.pro/download">
                Download
              </a>
            </div>
            <MobileMenuSection
              label="Resources"
              items={COMMUNITY_ITEMS}
              open={section === "resources"}
              onToggle={() =>
                setSection((s) => (s === "resources" ? null : "resources"))
              }
            />
            <div className="af-m-item">
              <a className="af-m-row" href="https://affine.pro/pricing">
                Pricing
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function LandingNavbar() {
  return (
    <header className="relative z-[234]">
      <DesktopNavbar />
      <MobileNavbar />
    </header>
  )
}
