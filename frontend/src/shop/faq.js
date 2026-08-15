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
      vi: "Chuyển khoản ngân hàng (quét mã VietQR) hoặc Momo.",
      en: "Bank transfer (VietQR) or Momo.",
    },
  },
  {
    question: {
      vi: "Tôi cần thanh toán trong bao lâu?",
      en: "How long do I have to pay?",
    },
    answer: {
      vi: "Bạn cần thanh toán trong thời hạn hiển thị ở trang đặt hàng (thường là 48 giờ). Quá hạn mà chưa có ảnh xác nhận thanh toán, đơn sẽ tự động hủy.",
      en: "Pay within the deadline shown on your order page (typically 48 hours). If no payment proof is uploaded by then, the order is automatically cancelled.",
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
      vi: "Ngay sau khi đặt hàng bạn sẽ nhận được một đường link riêng (và mã QR) tới trang đơn hàng — đường link này cũng được gửi qua email, kèm theo mã PIN xác thực. Lưu lại email đó: bạn cần cả link lẫn mã PIN để xem lại đơn hàng.",
      en: "Right after placing an order you get a personal link (and QR code) to your order page — the same link is emailed to you, along with a verification PIN. Keep that email: you need both the link and the PIN to view your order again.",
    },
  },
  {
    question: {
      vi: "Mã PIN xác thực đơn hàng dùng để làm gì?",
      en: "What is the order verification PIN for?",
    },
    answer: {
      vi: "Đây là mã 6 chữ số được gửi qua email khi bạn đặt hàng, dùng để xác nhận chính bạn là người đặt đơn trước khi xem trang đơn hàng — phòng trường hợp đường link bị vô tình chia sẻ cho người khác. Bạn chỉ cần nhập mã này một lần trên mỗi thiết bị/trình duyệt. Nếu nhập sai quá nhiều lần, đơn hàng sẽ tạm khóa xác thực trong 15 phút.",
      en: "It's a 6-digit code emailed to you when you place an order, used to confirm you're really the buyer before showing your order page — in case the link ever gets shared with someone else by accident. You only need to enter it once per device/browser. Too many wrong attempts temporarily locks verification for that order for 15 minutes.",
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
      vi: "Cách nhập địa chỉ giao hàng thế nào?",
      en: "How do I fill in the shipping address?",
    },
    answer: {
      vi: "Chọn Tỉnh/Thành phố rồi Phường/Xã, sau đó nhập số nhà và tên đường. Với chung cư/toà nhà (ví dụ: \"66B, Nguyễn Sĩ Sách\"), bấm nút tìm kiếm (biểu tượng kính lúp) bên cạnh ô số nhà, tên đường để chọn đúng địa chỉ đầy đủ thay vì gõ tay.",
      en: "Pick your Province/City, then Ward/Commune, then type your house number and street name. For apartment complexes/buildings (e.g. \"66B, Nguyễn Sĩ Sách\"), tap the search (magnifying glass) button next to the street field to pick the full, exact address instead of typing it out.",
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
