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
      vi: "Số thứ tự trên đơn nhận tại sự kiện dùng để làm gì?",
      en: "What's the queue number on my event-pickup order for?",
    },
    answer: {
      vi: "Đây là số thứ tự riêng cho bộ sưu tập bạn đã đặt, dùng để xếp hàng tại sự kiện - nhân viên sẽ gọi số theo thứ tự. Với đơn chuyển khoản/Momo/PayPal, số chỉ được cấp sau khi bạn tải ảnh chuyển khoản lên; đơn thanh toán khi nhận hàng (COD) được cấp số ngay khi đặt. Số hiện trên trang đơn hàng của bạn và trong email xác nhận.",
      en: "This is a number scoped to the collection you ordered from, used to queue in person at the event - staff call numbers in order. For bank transfer/Momo/PayPal orders, it's assigned once you upload your payment proof; cash-on-delivery (COD) orders get one immediately at checkout. It shows on your order page and in the confirmation email.",
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
      vi: "Quà tặng miễn phí khi mua đủ số tiền là gì?",
      en: "What's the free gift for orders over a certain amount?",
    },
    answer: {
      vi: "Khi tổng giá trị đơn hàng đạt mức tối thiểu người bán đang áp dụng (hiển thị ngay trong giỏ hàng khi có chương trình quà tặng), bạn tự động nhận thêm một quà tặng miễn phí - không cần nhập mã hay chọn gì thêm. Quà tặng hiện trong giỏ hàng và trang đơn hàng như một sản phẩm 0đ, không tính vào phí vận chuyển hay số tiền cần thanh toán.",
      en: "Once your cart's total reaches the minimum the seller is currently offering (shown right in your cart whenever a gift promotion is active), you automatically get one free gift added - no code or extra step needed. It appears in your cart and order page as a 0đ line item, and never adds to the shipping fee or the amount you pay.",
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
      vi: "Gacha là gì, mua lượt quay như thế nào?",
      en: "What is gacha, and how do I buy a turn?",
    },
    answer: {
      vi: "Gacha là sản phẩm mở hộp ngẫu nhiên: bạn mua một hoặc nhiều lượt quay, mỗi lượt trả về đúng một phần thưởng được chọn ngẫu nhiên theo tỉ lệ độ hiếm hiển thị ngay trên trang sản phẩm. Sau khi thanh toán được xác nhận, bạn tự mở từng lượt ngay trên trang đơn hàng của mình - phần thưởng nhận được sẽ được giao (ship) như một đơn hàng bình thường.",
      en: "Gacha is a mystery-box product: you buy one or more turns, and each turn gives back exactly one prize, picked randomly according to the rarity odds shown right on the product page. Once payment is confirmed, you open each turn yourself on your own order page - whatever you win ships to you like a normal order.",
    },
  },
  {
    question: {
      vi: "Tỉ lệ trúng mỗi độ hiếm được tính thế nào? Tôi có thể chọn phần thưởng không?",
      en: "How are the rarity odds calculated? Can I choose my prize?",
    },
    answer: {
      vi: "Không, bạn không thể chọn hoặc biết trước phần thưởng - mỗi lượt quay được máy chủ chọn ngẫu nhiên hoàn toàn dựa trên số lượng còn lại của từng phần thưởng, không thể can thiệp hay đoán trước. Tỉ lệ % hiển thị trên trang là tỉ lệ thật tại thời điểm bạn xem, và sẽ giảm dần khi kho quà vơi đi.",
      en: "No - you can't choose or predict your prize. Every turn's outcome is decided entirely server-side, weighted by each prize's real remaining stock, with no way to influence or guess it in advance. The percentages shown on the page are the real, live odds at that moment, and shift as prizes run out.",
    },
  },
  {
    question: {
      vi: "Tôi có thể quay thử trước khi mua không?",
      en: "Can I try before buying?",
    },
    answer: {
      vi: "Có - mỗi sản phẩm gacha đều có trang \"Quay thử\" miễn phí, quay không giới hạn số lần theo đúng tỉ lệ thật, nhưng kết quả ở đây chỉ để xem trước, không phải phần thưởng thật và không tốn tiền.",
      en: "Yes - every gacha product has a free \"Try it\" page where you can spin as many times as you like, using the real live odds. Results there are just a preview, not a real prize, and cost nothing.",
    },
  },
  {
    question: {
      vi: "Gacha có hỗ trợ thanh toán khi nhận hàng (COD) không?",
      en: "Does gacha support cash on delivery (COD)?",
    },
    answer: {
      vi: "Không - lượt quay được tính là đã dùng ngay khi đơn được xác nhận, nên không còn mốc giao hàng nào để thu tiền mặt. Chỉ thanh toán được qua chuyển khoản ngân hàng hoặc Momo.",
      en: "No - a gacha turn is considered spent the moment the order is confirmed, so there's no delivery moment left to collect cash at. Pay by bank transfer or Momo instead.",
    },
  },
  {
    question: {
      vi: "Vì sao có sản phẩm gacha tôi thấy ở sự kiện nhưng không mua online được?",
      en: "Why can't I buy a gacha product online even though I saw it at the event?",
    },
    answer: {
      vi: "Một số sản phẩm gacha được người bán đặt là chỉ bán tại quầy sự kiện (thanh toán trực tiếp bằng tiền mặt) - những sản phẩm này sẽ không xuất hiện trên cửa hàng online.",
      en: "Some gacha products are marked by the seller as booth-only - sold in person at the event, cash only - and won't appear in the online shop at all.",
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
