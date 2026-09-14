/**
 * Static FAQ content for the shop. Each entry is bilingual ({ vi, en }), like
 * the rest of the site's editable copy (see utils/localize.js) - no backend
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
      vi: "Sau khi chuyển khoản, tải lên ảnh chụp màn hình/biên lai ngay trên trang đơn hàng của bạn. Người bán sẽ kiểm tra và xác nhận - bạn có thể quay lại trang đơn hàng bất cứ lúc nào để xem trạng thái mới nhất.",
      en: "After transferring, upload a screenshot/receipt right on your order page. The seller reviews and confirms it - you can revisit your order page anytime to check the latest status.",
    },
  },
  {
    question: {
      vi: "Tôi tìm lại đơn hàng của mình như thế nào?",
      en: "How do I find my order again?",
    },
    answer: {
      vi: "Ngay sau khi đặt hàng, bạn sẽ được chuyển thẳng đến trang đơn hàng (chưa cần nhập mã PIN - trình duyệt vừa đặt đơn đã được xác thực sẵn). Đường link riêng (và mã QR) tới trang đó cũng được gửi qua email kèm mã PIN. Lưu lại email đó: nếu bạn mở lại link sau này hoặc từ thiết bị/trình duyệt khác, bạn sẽ cần nhập mã PIN.",
      en: "Right after placing an order, you're taken straight to your order page - no PIN needed yet, since the browser that just placed the order is already verified. The personal link (and QR code) to that page is also emailed to you, along with a verification PIN. Keep that email: opening the link again later, or from a different device/browser, will ask for the PIN.",
    },
  },
  {
    question: {
      vi: "Mã PIN xác thực đơn hàng dùng để làm gì?",
      en: "What is the order verification PIN for?",
    },
    answer: {
      vi: "Đây là mã 6 chữ số được gửi qua email khi bạn đặt hàng, dùng để xác nhận chính bạn là người đặt đơn trước khi xem trang đơn hàng - phòng trường hợp đường link bị vô tình chia sẻ cho người khác. Bạn không cần nhập mã này ngay sau khi đặt hàng (trình duyệt hiện tại đã được xác thực sẵn); mã chỉ được hỏi khi mở lại link sau này hoặc từ thiết bị/trình duyệt khác, và chỉ cần nhập một lần cho mỗi thiết bị/trình duyệt đó. Nếu nhập sai quá nhiều lần, đơn hàng sẽ tạm khóa xác thực trong 15 phút.",
      en: "It's a 6-digit code emailed to you when you place an order, used to confirm you're really the buyer before showing your order page - in case the link ever gets shared with someone else by accident. You don't need it right after checkout (that browser is already verified); it's only asked for when reopening the link later or from a different device/browser, and only once per device/browser after that. Too many wrong attempts temporarily locks verification for that order for 15 minutes.",
    },
  },
  {
    question: {
      vi: "Đơn nhận tại sự kiện thì lấy hàng thế nào?",
      en: "How does event pickup work?",
    },
    answer: {
      vi: "Khi đơn đã được xác nhận thanh toán, trang đơn hàng của bạn sẽ hiện mã xác nhận nhận hàng - đưa mã này cho người bán tại sự kiện để nhận hàng. Mã chỉ hiện sau khi thanh toán được xác nhận.",
      en: "Once your payment is confirmed, your order page shows a pickup verification code - show it to the seller at the event to collect your order. The code only appears after payment is confirmed.",
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
      vi: "Với đơn giao hàng: phí vận chuyển không nằm trong tổng tiền đơn hàng - bạn thanh toán phí này trực tiếp cho shipper khi nhận hàng. Đơn nhận tại sự kiện không phát sinh phí vận chuyển.",
      en: "For orders shipped to you: shipping isn't included in the order total - you pay that fee directly to the courier on delivery. Event pickup orders have no shipping fee at all.",
    },
  },
  {
    question: {
      vi: "Sản phẩm số hoạt động như thế nào?",
      en: "How do digital products work?",
    },
    answer: {
      vi: "Sản phẩm số không có phí vận chuyển và không hỗ trợ thanh toán khi nhận hàng (COD) - chỉ thanh toán qua chuyển khoản ngân hàng hoặc Momo. Sau khi thanh toán được xác nhận, đường link tải sản phẩm sẽ hiện ngay trên trang đơn hàng của bạn và trong email xác nhận.",
      en: "Digital products have no shipping fee and aren't available for cash on delivery (COD) - pay by bank transfer or Momo instead. Once payment is confirmed, the download link appears right on your order page and in the confirmation email.",
    },
  },
  {
    question: {
      vi: "Vì sao tôi không thấy một đợt mở bán, hoặc không đặt được nữa?",
      en: "Why can't I see a drop, or why can't I order from it anymore?",
    },
    answer: {
      vi: "Một số đợt mở bán được người bán đặt lịch mở/đóng vào thời điểm cụ thể. Trước giờ mở, bạn vẫn xem được sản phẩm và giá nhưng chưa đặt hàng được - trang sẽ hiển thị rõ ngày giờ mở bán. Sau khi đã đến giờ đóng, bạn vẫn xem được sản phẩm nhưng không đặt hàng được nữa - trang sẽ hiển thị rõ trạng thái này.",
      en: "Some drops are scheduled by the seller to open and close at specific times. Before the opening time, you can still browse the products and prices, but you can't order yet - the page clearly shows the exact opening date/time. After the scheduled close time, you can still browse it, but ordering is closed - the page will clearly show this.",
    },
  },
  {
    question: {
      vi: "Tôi có thể hủy hoặc đổi đơn hàng không?",
      en: "Can I cancel or change my order?",
    },
    answer: {
      vi: "Vui lòng liên hệ người bán qua thông tin ở trang chủ càng sớm càng tốt. Nếu đơn bị hủy (do bạn yêu cầu hoặc do quá hạn thanh toán), bạn sẽ nhận được email nêu rõ lý do.",
      en: "Please contact the seller (see the contact links on the homepage) as soon as possible. If an order is cancelled - whether by request or because the payment deadline passed - you'll get an email explaining why.",
    },
  },
  {
    question: {
      vi: "Tôi nhập sai tên, số điện thoại hoặc địa chỉ, sửa lại thế nào?",
      en: "I entered the wrong name, phone number, or address - how do I fix it?",
    },
    answer: {
      vi: "Khi đơn còn ở trạng thái chờ thanh toán, bạn có thể tự sửa tên người nhận, số điện thoại, ghi chú và địa chỉ giao hàng (nếu đơn có giao hàng) ngay trên trang đơn hàng của mình - không sửa được email. Sau khi đơn đã được xác nhận, vui lòng liên hệ người bán để được hỗ trợ chỉnh sửa.",
      en: "While your order is still pending payment, you can edit the recipient name, phone number, note, and shipping address (for orders that ship) right on your order page - email can't be changed. Once the order is confirmed, please contact the seller for help making the change.",
    },
  },
  {
    question: {
      vi: "Sản phẩm hiện \"Hết hàng\" nghĩa là gì?",
      en: "What does \"Sold out\" mean?",
    },
    answer: {
      vi: "Nghĩa là mẫu/kích cỡ đó đã hết hàng dự trữ. Các mẫu khác của cùng sản phẩm vẫn có thể còn hàng - hãy kiểm tra từng mẫu trong bộ ảnh.",
      en: "That specific variant (size/code) is out of stock. Other variants of the same product may still be available - check each one in the photo grid.",
    },
  },
]
