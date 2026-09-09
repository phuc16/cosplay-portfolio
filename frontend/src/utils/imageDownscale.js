// Matches the backend's own resize ceiling (shop/images.js MAX_WIDTH,
// server.js MAX_FULL_WIDTH) - downscaling further than the server would
// anyway loses no quality the server wasn't already going to discard,
// while cutting upload bytes (and therefore transfer time) for any photo
// the server was going to shrink either way.
export const MAX_DIMENSION = 1920
export const DOWNSCALE_QUALITY = 0.82

/** Pure dimension math - never upscales, always fits the longer side to maxDimension. */
export function computeDownscaleDimensions(width, height, maxDimension) {
  const scale = Math.min(1, maxDimension / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * Downscales and re-encodes an image File to WebP via <canvas>, capped at
 * MAX_DIMENSION on its longer side. Falls back to returning the original
 * file unchanged on any failure (non-image input, decode error, canvas
 * unsupported) - a failed downscale must never block the upload itself,
 * since the server re-encodes every upload through sharp anyway regardless
 * of what the client sends.
 */
export function downscaleImage(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) return Promise.resolve(file)

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      try {
        const { width, height } = computeDownscaleDimensions(img.naturalWidth, img.naturalHeight, MAX_DIMENSION)
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) return resolve(file)
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          (blob) => resolve(blob ? new File([blob], file.name, { type: "image/webp" }) : file),
          "image/webp",
          DOWNSCALE_QUALITY
        )
      } catch {
        resolve(file)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(file)
    }
    img.src = objectUrl
  })
}
