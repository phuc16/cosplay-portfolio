const jwt = require("jsonwebtoken")

module.exports = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]
  if (!token) {
    console.warn("[AUTH] Thiếu token")
    return res.status(401).json({ error: "unauthorized", message: "Chưa đăng nhập" })
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] })
    next()
  } catch (err) {
    console.warn("[AUTH] Token không hợp lệ:", err.message)
    res.status(403).json({ error: "forbidden", message: "Phiên đăng nhập hết hạn. Đăng nhập lại." })
  }
}
