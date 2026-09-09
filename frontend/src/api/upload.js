import { api } from "./api"
import { downscaleImage } from "../utils/imageDownscale"

/**
 * Shared upload path for every image-upload call site (portfolio hero/
 * thumbnail/event/album images, shop catalog images, buyer payment-proof
 * screenshots). Downscales the file client-side first (cuts transfer bytes
 * on a slow connection), then sends it as multipart/form-data - the server
 * side no longer accepts base64-in-JSON, since JSON.parse on a large
 * string blocks Node's single event loop for every concurrent user.
 */
export async function uploadImage(url, file, extraFields = {}, config = {}) {
  const processed = await downscaleImage(file)
  const formData = new FormData()
  formData.append("file", processed)
  for (const [key, value] of Object.entries(extraFields)) {
    formData.append(key, value)
  }
  const res = await api.post(url, formData, config)
  return res.data
}
