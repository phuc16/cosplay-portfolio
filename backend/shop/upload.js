const multer = require("multer")
const { MAX_UPLOAD_BYTES } = require("./images")

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
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
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: "invalid_input",
          message: `Ảnh quá lớn, tối đa ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB`,
        })
      }
      if (err) return next(err)
      next()
    })
  }
}

module.exports = { uploadSingleImage }
