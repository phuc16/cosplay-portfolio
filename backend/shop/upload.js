const multer = require("multer")
const { MAX_UPLOAD_BYTES } = require("./images")

// Every real caller sends at most one text field alongside the file
// (folder or album_id) - bounding fields/parts/fieldNameSize prevents an
// authenticated caller from sending a multipart body with thousands of
// extra text fields (each up to busboy's default 1MB fieldSize) to force
// large memory allocation before this middleware ever rejects the request.
const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, fieldNameSize: 100 },
})

/**
 * multipart/form-data image upload gate. On success, req.file.buffer holds
 * the raw bytes and req.body holds any other form fields (folder, album_id,
 * etc.) - the same req.body shape express.json() used to populate for the
 * base64-JSON routes this replaces.
 *
 * Maps multer's LIMIT_FILE_SIZE error to the same 400/invalid_input shape
 * shop/images.js's own validateImageBuffer oversize check already returns,
 * so callers and existing tests see identical error text regardless of
 * which layer catches the oversize (multer here, before any bytes are ever
 * decoded, vs. validateImageBuffer downstream for a base64 payload that
 * somehow got past this gate).
 */
function uploadSingleImage(fieldName = "file") {
  const middleware = multerUpload.single(fieldName)
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            error: "invalid_input",
            message: `Ảnh quá lớn, tối đa ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB`,
          })
        }
        // Any other MulterError (extra file part, too many fields, an
        // oversized field name, ...) is a malformed request, not a server
        // fault - a 500 here would misreport a client mistake as ours.
        return res.status(400).json({ error: "invalid_input", message: "Yêu cầu tải ảnh không hợp lệ" })
      }
      if (err) return next(err)
      next()
    })
  }
}

module.exports = { uploadSingleImage }
