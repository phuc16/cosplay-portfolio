const jwt = require("jsonwebtoken")

module.exports = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]
  if (!token) {
    console.warn("[AUTH] Thiếu token")
    return res.status(401).json({ error: "unauthorized", message: "Chưa đăng nhập" })
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] })
    // Every JWT this app issues is signed with the same JWT_SECRET, including
    // the buyer order-access session token (orderAccess.js's
    // issueOrderSessionToken, handed to every buyer in the checkout
    // response) - without this check, that token verifies fine here too and
    // would pass as a full admin session on every /api/admin/* route.
    if (payload.role !== "admin") {
      console.warn("[AUTH] Token hợp lệ nhưng không phải admin")
      return res.status(403).json({ error: "forbidden", message: "Không có quyền truy cập" })
    }
    req.user = payload
    next()
  } catch (err) {
    console.warn("[AUTH] Token không hợp lệ:", err.message)
    res.status(403).json({ error: "forbidden", message: "Phiên đăng nhập hết hạn. Đăng nhập lại." })
  }
}
