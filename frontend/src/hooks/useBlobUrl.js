import { useEffect, useState } from "react"

/**
 * Fetches an image/SVG that requires an Authorization header (so a plain
 * <img src="..."> can't be used — browsers never attach custom headers to
 * those requests) and exposes it as a blob: object URL instead. Revokes the
 * previous URL whenever the fetch args change or the component unmounts, so
 * a page that re-fetches repeatedly (e.g. after a PIN unlock) doesn't leak
 * one blob per fetch.
 */
export function useBlobUrl(fetchBlob, deps, enabled = true) {
  const [src, setSrc] = useState(null)

  useEffect(() => {
    if (!enabled) {
      setSrc(null)
      return
    }
    let cancelled = false
    let objectUrl = null

    fetchBlob().then((blob) => {
      if (cancelled) return
      objectUrl = URL.createObjectURL(blob)
      setSrc(objectUrl)
    }).catch(() => {
      if (!cancelled) setSrc(null)
    })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return src
}
