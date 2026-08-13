/**
 * Static FAQ content for the shop. Each entry is bilingual ({ vi, en }), like
 * the rest of the site's editable copy (see utils/localize.js) — no backend
 * table for this yet, since the content changes rarely enough that editing
 * this file is simpler than building an admin panel for it.
 */
export const FAQ_ITEMS = [
  {
    question: {
      vi: "Có những hình thức thanh toán nào?",
      en: "What payment methods are available?",
    },
    answer: {
      vi: "Chuyển khoản ngân hàng (quét mã VietQR), Momo, PayPal, hoặc thanh toán khi nhận hàng (COD) cho đơn giao hàng. COD không áp dụng cho đơn nhận tại sự kiện — đơn nhận tại sự kiện luôn cần thanh toán trước.",
      en: "Bank transfer (VietQR), Momo, PayPal, or Cash on Delivery (COD) for shipped orders. COD isn't available for event pickup orders — those always require prepayment.",
    },
  },
  {
    question: {
      vi: "Tôi cần thanh toán trong bao lâu?",
      en: "How long do I have to pay?",
    },
    answer: {
      vi: "Với các phương thức chuyển khoản trước (VietQR/Momo/PayPal), bạn cần thanh toán trong thời hạn hiển thị ở trang đặt hàng (thường là 48 giờ). Quá hạn mà chưa có ảnh xác nhận thanh toán, đơn sẽ tự động hủy để nhả lại hàng cho người khác. Đơn COD không có thời hạn này.",
      en: "For prepay methods (VietQR/Momo/PayPal), pay within the deadline shown on your order page (typically 48 hours). If no payment proof is uploaded by then, the order is automatically cancelled so the stock can go back on sale. COD orders have no such deadline.",
    },
  },
  {
    question: {
      vi: "Làm sao để xác nhận tôi đã thanh toán?",
      en: "How do I confirm I've paid?",
    },
    answer: {
      vi: "Sau khi chuyển khoản, tải lên ảnh chụp màn hình/biên lai ngay trên trang đơn hàng của bạn. Người bán sẽ kiểm tra và xác nhận — bạn có thể quay lại trang đơn hàng bất cứ lúc nào để xem trạng thái mới nhất.",
      en: "After transferring, upload a screenshot/receipt right on your order page. The seller reviews and confirms it — you can revisit your order page anytime to check the latest status.",
    },
  },
  {
    question: {
      vi: "Tôi tìm lại đơn hàng của mình như thế nào?",
      en: "How do I find my order again?",
    },
    answer: {
      vi: "Ngay sau khi đặt hàng bạn sẽ nhận được một đường link riêng (và mã QR) tới trang đơn hàng — đường link này cũng được gửi qua email. Lưu lại link đó, vì đó là cách duy nhất để xem đơn hàng mà không cần đăng nhập.",
      en: "Right after placing an order you get a personal link (and QR code) to your order page — the same link is also emailed to you. Keep it, since it's the only way to view your order without logging in.",
    },
  },
  {
    question: {
      vi: "Đơn nhận tại sự kiện thì lấy hàng thế nào?",
      en: "How does event pickup work?",
    },
    answer: {
      vi: "Khi đơn đã được xác nhận thanh toán, trang đơn hàng của bạn sẽ hiện mã xác nhận nhận hàng — đưa mã này cho người bán tại sự kiện để nhận hàng. Mã chỉ hiện sau khi thanh toán được xác nhận.",
      en: "Once your payment is confirmed, your order page shows a pickup verification code — show it to the seller at the event to collect your order. The code only appears after payment is confirmed.",
    },
  },
  {
    question: {
      vi: "Ai chịu phí vận chuyển?",
      en: "Who pays for shipping?",
    },
    answer: {
      vi: "Phí vận chuyển không nằm trong tổng tiền đơn hàng — bạn thanh toán phí này trực tiếp cho shipper khi nhận hàng.",
      en: "Shipping isn't included in the order total — you pay that fee directly to the courier on delivery.",
    },
  },
  {
    question: {
      vi: "Tôi có thể hủy hoặc đổi đơn hàng không?",
      en: "Can I cancel or change my order?",
    },
    answer: {
      vi: "Vui lòng liên hệ người bán qua thông tin ở trang chủ càng sớm càng tốt. Nếu đơn bị hủy (do bạn yêu cầu hoặc do quá hạn thanh toán), bạn sẽ nhận được email nêu rõ lý do.",
      en: "Please contact the seller (see the contact links on the homepage) as soon as possible. If an order is cancelled — whether by request or because the payment deadline passed — you'll get an email explaining why.",
    },
  },
  {
    question: {
      vi: "Sản phẩm hiện \"Hết hàng\" nghĩa là gì?",
      en: "What does \"Sold out\" mean?",
    },
    answer: {
      vi: "Nghĩa là mẫu/kích cỡ đó đã hết hàng dự trữ. Các mẫu khác của cùng sản phẩm vẫn có thể còn hàng — hãy kiểm tra từng mẫu trong bộ ảnh.",
      en: "That specific variant (size/code) is out of stock. Other variants of the same product may still be available — check each one in the photo grid.",
    },
  },
]
