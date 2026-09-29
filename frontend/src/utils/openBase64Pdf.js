/** Decode a base64 PDF payload and open it in a new tab, so the browser's
 *  own PDF viewer (and its print button) handles it - not a forced download,
 *  and not window.print() on an HTML page. */
export function openBase64Pdf(base64) {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i += 1) arr[i] = bytes.charCodeAt(i)
  const blob = new Blob([arr], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)
  window.open(url, "_blank")
  // Deliberately not revoked immediately - the new tab needs the blob: URL to
  // stay valid while it loads/renders the PDF. Left for the browser to
  // reclaim on tab close, same tradeoff as other short-lived object URLs in
  // this codebase.
}
