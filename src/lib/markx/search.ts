/** Visible text of a note: tags removed and entities decoded (&amp; → &). */
export function noteText(html: string): string {
  if (typeof DOMParser === "undefined") {
    return html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }
  const doc = new DOMParser().parseFromString(html, "text/html")
  for (const block of doc.body.querySelectorAll("p, li, br, h1, h2, h3")) {
    block.append(" ")
  }
  return doc.body.textContent.replace(/\s+/g, " ").trim()
}

/**
 * Match only what the user sees. Item values hold unique ids (cmdk needs
 * unique values), so the default fuzzy filter would match random id
 * letters. Every query word must appear in the item's keywords.
 */
export function filterByKeywords(
  _value: string,
  search: string,
  keywords?: string[]
): number {
  const text = (keywords ?? []).join(" ").toLowerCase()
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  return words.every((word) => text.includes(word)) ? 1 : 0
}
