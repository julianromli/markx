import { cn } from "@/lib/utils"
import type { NoteColor } from "@/lib/markx/types"

export const NOTE_COLORS: Record<NoteColor, string> = {
  yellow: "#fef08a",
  blue: "#bfdbfe",
  pink: "#fbcfe8",
  green: "#bbf7d0",
  orange: "#fed7aa",
  purple: "#ddd6fe",
}

export function NoteColorChoices({
  selected,
  size = "small",
  onSelect,
}: {
  selected?: NoteColor
  size?: "small" | "large"
  onSelect: (color: NoteColor) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(NOTE_COLORS) as NoteColor[]).map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          onClick={() => onSelect(color)}
          className={cn(
            "rounded-full transition-transform active:scale-95 hover-fine:hover:scale-105",
            size === "large"
              ? "size-9 border border-black/10"
              : "size-7 border-2",
            size === "small" &&
              (selected === color ? "border-[#202020]" : "border-black/15")
          )}
          style={{ backgroundColor: NOTE_COLORS[color] }}
        />
      ))}
    </div>
  )
}
