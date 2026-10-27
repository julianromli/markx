import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight"

import homeIcon from "@/assets/markx/header/home.svg"

/**
 * "Make your own" pill for anonymous viewers of a read-only share link.
 * Sits top-right as a twin of the board title chip. Desktop shows the
 * markx logotype and "Make your own"; below `sm` it collapses to the
 * logo and "Make yours" at a 44px tap height.
 */
export function ShareCta({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Make yours: make your own board on markx"
      className="share-cta-in group absolute top-3 right-3 z-30 flex h-11 items-center gap-2 rounded-xl bg-white/85 pr-1.5 pl-2.5 text-sm shadow-sm outline outline-1 outline-black/5 backdrop-blur transition-[background-color] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/30 sm:h-10 sm:gap-2.5 sm:pl-3 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/95"
    >
      <span className="flex items-center gap-1.5">
        <span className="relative size-5 shrink-0 drop-shadow-[0_1px_1px_rgba(51,61,78,0.3)]">
          <img
            src={homeIcon}
            alt=""
            className="size-full"
            width={20}
            height={20}
          />
        </span>
        <span className="hidden text-[15px] font-semibold tracking-[-0.02em] text-ink sm:inline">
          markx
        </span>
      </span>
      <span aria-hidden className="hidden h-4 w-px bg-black/10 sm:block" />
      <span className="inline-flex h-8 items-center gap-1 rounded-lg bg-linear-to-b from-[oklch(0.3_0_0)] to-[oklch(0.14_0_0)] pr-2.5 pl-3 text-[13px] font-medium whitespace-nowrap text-white shadow-[0_1px_2px_rgba(0,0,0,0.22)] transition-[filter,scale] duration-150 ease-[var(--ease-out-strong)] group-active:scale-[0.97] motion-reduce:group-active:scale-100 sm:h-7 [@media(hover:hover)_and_(pointer:fine)]:group-hover:brightness-110">
        <span className="hidden sm:inline">Make your own</span>
        <span className="sm:hidden">Make yours</span>
        <ArrowRightIcon className="size-3.5" weight="regular" />
      </span>
    </button>
  )
}
