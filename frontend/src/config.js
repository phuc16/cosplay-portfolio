export const COLOR_SCHEMES = {
  pink:   { brand:"#ec4899", hover:"#f472b6", strong:"#db2777", glow:"rgba(236,72,153,.30)", soft:"rgba(236,72,153,.15)", grad1:"#f472b6", grad2:"#fb7185" },
  blue:   { brand:"#3b82f6", hover:"#60a5fa", strong:"#2563eb", glow:"rgba(59,130,246,.30)",  soft:"rgba(59,130,246,.15)",  grad1:"#60a5fa", grad2:"#818cf8" },
  purple: { brand:"#8b5cf6", hover:"#a78bfa", strong:"#7c3aed", glow:"rgba(139,92,246,.30)", soft:"rgba(139,92,246,.15)", grad1:"#a78bfa", grad2:"#c084fc" },
  amber:  { brand:"#f59e0b", hover:"#fbbf24", strong:"#d97706", glow:"rgba(245,158,11,.30)",  soft:"rgba(245,158,11,.15)",  grad1:"#fbbf24", grad2:"#fb923c" },
  rose:   { brand:"#f43f5e", hover:"#fb7185", strong:"#e11d48", glow:"rgba(244,63,94,.30)",   soft:"rgba(244,63,94,.15)",   grad1:"#fb7185", grad2:"#fda4af" },
}

export function applyColorScheme(name) {
  const sc = COLOR_SCHEMES[name] || COLOR_SCHEMES.pink
  const r = document.documentElement
  r.style.setProperty("--brand",             sc.brand)
  r.style.setProperty("--brand-hover",       sc.hover)
  r.style.setProperty("--brand-strong",      sc.strong)
  r.style.setProperty("--brand-soft",        sc.soft)
  r.style.setProperty("--border-brand",      sc.soft.replace(".15)", ".50)").replace(".30)", ".50)").replace(".10)", ".50)"))
  r.style.setProperty("--text-link",         sc.brand)
  r.style.setProperty("--shadow-pink-glow",  "0 0 20px " + sc.glow)
  r.style.setProperty("--shadow-pink-soft",  "0 4px 14px " + sc.soft)
  r.style.setProperty("--shadow-pink-hover", "0 20px 25px -5px " + sc.glow + ", 0 8px 10px -6px " + sc.glow)
  r.style.setProperty("--grad1",             sc.grad1)
  r.style.setProperty("--grad2",             sc.grad2)
  // Recolor the pink/rose token aliases so hero gradient text + dots follow the scheme
  r.style.setProperty("--pink-400",          sc.grad1)
  r.style.setProperty("--rose-400",          sc.grad2)
  r.style.setProperty("--pink-500",          sc.brand)
}

export const SITE_CONFIG = {
  colorScheme: "pink",
  heroImageUrl: "",
  thumbnailImageUrl: "",
  heroImages: ["/refassets/hero1.svg", "/refassets/hero2.svg", "/refassets/hero3.svg"],
  heroAccents: [],
  heroCover: "/refassets/cover.svg",
  latestPhotos: [],
  logoUrl: "",
  footerChar: "/refassets/footer.svg",
  artistName: { vi: "Kamidayhehe", en: "Kamidayhehe" },
  tagline: { vi: "Cosplayer • Prop Maker", en: "Cosplayer • Prop Maker" },
  about: {
    vi: "Xin chào! Mình làm cosplay chủ yếu theo thể loại anime/game, tự làm đồ, props và có kinh nghiệm chụp hình sự kiện. Nhận đặt lịch cho convention, photoshoot và collab.",
    en: "Hi! I do cosplay mostly in anime/game genres, make my own costumes and props, and have experience shooting at events. Booking open for conventions, photoshoots and collabs.",
  },
  achievements: [
    { title: { vi: "100+ Cosplay", en: "100+ Cosplays" }, description: { vi: "Anime, game & thiết kế gốc từ 2018", en: "Anime, game & original designs since 2018" } },
    { title: { vi: "20+ Convention", en: "20+ Conventions" }, description: { vi: "Khách mời & thí sinh tại các sự kiện lớn ở VN", en: "Guest & competitor at major VN events" } },
    { title: { vi: "10K+ Người theo dõi", en: "10K+ Followers" }, description: { vi: "Trên Facebook, Instagram & TikTok", en: "Across Facebook, Instagram & TikTok" } },
  ],
  upcomingEvents: [
    { title: { vi: "Comic Con Vietnam 2026", en: "Comic Con Vietnam 2026" }, date: { vi: "15 Th8, 2026", en: "Aug 15, 2026" }, url: "", showPopup: true, imageUrl: "" },
    { title: { vi: "AniMate Festival — khách mời", en: "AniMate Festival — guest" }, date: { vi: "02 Th9, 2026", en: "Sep 02, 2026" }, url: "", showPopup: false, imageUrl: "" },
    { title: { vi: "Studio drop (collab)", en: "Studio drop (collab)" }, date: { vi: "20 Th9, 2026", en: "Sep 20, 2026" }, url: "", showPopup: false, imageUrl: "" },
  ],
  contact: {
    phone: "+84 90 123 4567",
    email: "hello@kamidayhehe.com",
    contactLinks: [],
    social: [
      { platform: "facebook", label: "Facebook", url: "https://facebook.com/kamimoe1911" },
      { platform: "instagram", label: "Instagram", url: "https://instagram.com/kamidayhehe" },
      { platform: "page", label: "Page", url: "https://facebook.com/kamimoe1911" },
      { platform: "x", label: "X", url: "https://x.com/Kamidayhehe" },
      { platform: "tiktok", label: "TikTok", url: "https://tiktok.com/@kamidayhehe" },
      { platform: "discord", label: "Discord", url: "https://discord.gg/kamidayhehe" },
    ],
    supports: {
      gumroad: "https://kamidayhehe.gumroad.com",
      gank: "https://ganknow.com/kamidayhehe",
      paypal: "https://paypal.com/kamidayhehe",
    },
  },
}
