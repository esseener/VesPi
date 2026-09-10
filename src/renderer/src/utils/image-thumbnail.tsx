import { useEffect, useMemo, useState } from 'react'

// Attachments arrive as base64 payloads that can be several MB. Pointing a
// 20px/64px thumbnail <img> at the full data URL forces Chromium to decode the
// whole image on every mount — and chat bubbles remount constantly while
// streaming. ScaledImage downscales large images once, caches the thumbnail,
// and swaps it in; the full payload is only decoded on the very first render.
const THUMB_SIZE = 128
const MAX_CACHE_ENTRIES = 100

// Below this payload size the downscale round-trip costs more than it saves.
const MIN_DOWNSCALE_CHARS = 65_536

const thumbCache = new Map<string, string>()

function cacheKey(mimeType: string, data: string): string {
  return `${mimeType}:${data.length}:${data.slice(0, 128)}`
}

/**
 * Returns an <img> src for a base64 image payload: a cached, downscaled
 * thumbnail when the source is large, the original data URL otherwise. SVGs
 * are returned as-is (canvas rasterization of sized-less SVGs is unreliable).
 */
export function useScaledImageSrc(mimeType: string, data: string): string {
  const key = cacheKey(mimeType, data)
  const fullSrc = useMemo(() => `data:${mimeType};base64,${data}`, [mimeType, data])
  const [src, setSrc] = useState(() => thumbCache.get(key) ?? fullSrc)

  useEffect(() => {
    const cached = thumbCache.get(key)
    if (cached) {
      setSrc(cached)
      return
    }
    if (mimeType.includes('svg') || data.length < MIN_DOWNSCALE_CHARS) {
      setSrc(fullSrc)
      return
    }

    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      const scale = Math.min(1, THUMB_SIZE / Math.max(img.width, img.height, 1))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, w, h)
      // Keep PNG for sources with likely transparency; JPEG otherwise.
      const thumb = mimeType === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85)
      if (thumbCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = thumbCache.keys().next().value
        if (oldest !== undefined) thumbCache.delete(oldest)
      }
      thumbCache.set(key, thumb)
      setSrc(thumb)
    }
    // On decode failure just keep the original src.
    img.src = fullSrc
    return () => {
      cancelled = true
    }
  }, [key, fullSrc, mimeType, data.length])

  return src
}

/** Thumbnail <img> for a base64 attachment payload (see useScaledImageSrc). */
export function ScaledImage({
  mimeType,
  data,
  alt,
  className,
}: {
  mimeType: string
  data: string
  alt: string
  className?: string
}): React.JSX.Element {
  const src = useScaledImageSrc(mimeType, data)
  return <img src={src} alt={alt} className={className} />
}

/** Test hook: drop all cached thumbnails. */
export function clearScaledImageCache(): void {
  thumbCache.clear()
}
