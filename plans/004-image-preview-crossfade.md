# 004 — Crossfade image previews into view

- **Status**: IMPLEMENTED
- **Commit**: 12cbde6
- **Severity**: MEDIUM
- **Category**: Missed opportunities (Preventing a jarring change)
- **Estimated scope**: 2 files, ~20 lines

## Problem

`ImageCard` replaces its loading placeholder with the resolved image in one
render. The image can appear after an asynchronous IndexedDB lookup, so the
canvas item changes abruptly.

```tsx
/* src/components/markx/image-card.tsx:21-29 — current */
  useEffect(() => {
    let cancelled = false
    void resolveImageBlob(image.imageId).then((blob) => {
      if (cancelled || !blob) return
      setUrl(getImageObjectUrl(image.imageId, blob))
    })
    return () => {
      cancelled = true
    }
  }, [image.imageId])
```

```tsx
/* src/components/markx/image-card.tsx:41-53 — current */
        {url ? (
          <img
            src={url}
            alt=""
            className="size-full object-contain outline outline-1 outline-black/10"
            draggable={false}
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-black/5">
            <div className="size-6 animate-pulse rounded-full border-2 border-black/15 border-t-black/40" />
          </div>
        )}
```

## Target

Keep the placeholder behavior unchanged. Add a CSS-only entrance to the newly
mounted image. Use `opacity` only because the image position and size must stay
stable.

```css
/* src/styles.css — add inside the existing @layer utilities block */
.image-preview-in {
  opacity: 1;
  transition: opacity 180ms var(--ease-out-strong);
}
@starting-style {
  .image-preview-in {
    opacity: 0;
  }
}
```

```tsx
/* src/components/markx/image-card.tsx:43 — target */
            className="image-preview-in size-full object-contain outline outline-1 outline-black/10"
```

## Repo conventions to follow

- Reuse `--ease-out-strong`, defined in `src/styles.css:18`.
- Add the utility inside the existing `@layer utilities` block.
- Use `@starting-style`, as used by `.board-item-in` in `src/styles.css`.
- Animate `opacity` only. Do not animate image layout or board transforms.
- The global reduced-motion rule in `src/styles.css:323` keeps the change
  effectively instant when reduced motion is enabled.

## Steps

1. Add `.image-preview-in` and its `@starting-style` block to
   `src/styles.css`.
2. Add `image-preview-in` to the resolved image `<img>` class in
   `src/components/markx/image-card.tsx`.

## Boundaries

- Do not change `resolveImageBlob`, object URL handling, or cancellation.
- Do not change the loading placeholder.
- Do not animate `transform`, `width`, `height`, or layout properties.
- Do not add dependencies.
- If the cited code changed since commit `12cbde6`, stop and report.

## Verification

- **Mechanical**: Run `bun run typecheck` and `bun run lint`.
- **Feel check**:
  - Open a board containing an image.
  - Confirm the placeholder remains stable while the image fades in over
    about `180ms`.
  - Confirm the image does not move or resize during the fade.
  - Toggle reduced motion and confirm the image appears without a fade.
- **Done when**: resolved images fade in without changing their board geometry.
