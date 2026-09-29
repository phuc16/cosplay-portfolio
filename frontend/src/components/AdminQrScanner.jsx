/* eslint-disable react-refresh/only-export-components -- extractOrderToken is
   exported alongside the component so its pure regex logic is unit-testable
   without the surrounding camera/canvas code, which jsdom cannot exercise. */
import { useEffect, useRef, useState } from "react"

// Behavior is unchanged from the inline version this replaces.
export const ORDER_TOKEN_RE = /\/order\/([0-9a-f]{32})/
export function extractOrderToken(value) {
  return value?.match(ORDER_TOKEN_RE)?.[1]
}

/**
 * Uses the native BarcodeDetector where available and falls back to jsQR,
 * because iOS Safari does not implement BarcodeDetector. Loaded only on this
 * route so it never reaches the buyer bundle.
 */
export default function AdminQrScanner({ onToken, onClose }) {
  const videoRef = useRef(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let stream, raf, cancelled = false

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        if (cancelled) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()

        const detector = "BarcodeDetector" in window
          ? new window.BarcodeDetector({ formats: ["qr_code"] })
          : null
        const jsQR = detector ? null : (await import("jsqr")).default
        const canvas = document.createElement("canvas")
        const ctx = canvas.getContext("2d", { willReadFrequently: true })

        const tick = async () => {
          if (cancelled || !videoRef.current?.videoWidth) {
            raf = requestAnimationFrame(tick)
            return
          }
          let value = null
          if (detector) {
            const [found] = await detector.detect(videoRef.current)
            value = found?.rawValue
          } else {
            canvas.width = videoRef.current.videoWidth
            canvas.height = videoRef.current.videoHeight
            ctx.drawImage(videoRef.current, 0, 0)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            value = jsQR(img.data, img.width, img.height)?.data
          }

          // The QR holds the public order URL; extract the token and let the
          // caller open the authenticated admin view instead.
          const token = extractOrderToken(value)
          if (token) return onToken(token)

          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch (e) {
        setError(e.name === "NotAllowedError" ? "Cần cho phép truy cập camera" : "Không mở được camera")
      }
    }

    start()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onToken])

  return (
    // overflow-y-auto + the video's own max-h-[70vh]: without a height cap,
    // a tablet in landscape (or just an unusual camera aspect ratio) can
    // render a video taller than the viewport - with no scroll affordance,
    // that pushes the close button off-screen with no way to reach it,
    // stranding whoever's scanning until the camera stream itself errors out.
    <div className="fixed inset-0 bg-black/80 flex flex-col items-center justify-center z-50 p-4 overflow-y-auto">
      {error
        ? <p className="text-white mb-4">{error}</p>
        : <video ref={videoRef} playsInline muted className="max-w-full max-h-[70vh] rounded-xl" />}
      <button type="button" onClick={onClose} className="mt-4 px-5 py-2.5 rounded-lg bg-white text-black shrink-0">
        Đóng
      </button>
    </div>
  )
}
