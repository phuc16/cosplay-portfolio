/** Logo + màu thương hiệu cho các nền tảng */

const size = 20

export const contactPlatforms = {
  zalo: {
    color: "#0068FF",
    borderClass: "border-[#0068FF] hover:border-[#0068FF] hover:bg-[#0068FF]/10",
    Icon: () => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6l-2 2V4h16v10z" />
      </svg>
    ),
  },
  whatsapp: {
    color: "#25D366",
    borderClass: "border-[#25D366] hover:border-[#25D366] hover:bg-[#25D366]/10",
    Icon: () => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
    ),
  },
  gmail: {
    color: "#EA4335",
    borderClass: "border-[#EA4335] hover:border-[#EA4335] hover:bg-[#EA4335]/10",
    Icon: () => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
        <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
      </svg>
    ),
  },
}

export const supportPlatforms = {
  gumroad: {
    color: "#FF90E8",
    borderClass: "border-[#FF90E8] hover:border-[#FF90E8] hover:bg-[#FF90E8]/10",
    Icon: () => (
      <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
        <circle cx="12" cy="12" r="11" fill="#FF90E8" stroke="#000" strokeWidth="1" />
        <text x="12" y="16" textAnchor="middle" fill="#000" fontSize="14" fontWeight="bold" fontFamily="system-ui,sans-serif">G</text>
      </svg>
    ),
  },
  gank: {
    color: "#E84C3D",
    borderClass: "border-[#E84C3D] hover:border-[#E84C3D] hover:bg-[#E84C3D]/10",
    Icon: () => (
      <img src="/gank.png" alt="Gank" width={size} height={size} className="shrink-0 object-contain" />
    ),
  },
  paypal: {
    color: "#003087",
    borderClass: "border-[#003087] hover:border-[#003087] hover:bg-[#003087]/10",
    Icon: () => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
        <path d="M7.076 21.337H2.47a.641.641 0 01-.633-.74L4.944 3.72a.77.77 0 01.758-.633h5.165c2.35 0 4.128.633 5.33 1.898 1.205 1.264 1.794 2.995 1.77 5.193-.048 3.19-.882 5.358-2.505 6.506-1.623 1.148-3.735 1.707-6.337 1.676H9.38l-.598 3.48a.641.641 0 01-.633.548z"/>
      </svg>
    ),
  },
}

export const socialPlatforms = {
  instagram: { color: "#E4405F", borderClass: "border-[#E4405F] hover:border-[#E4405F] hover:bg-[#E4405F]/10" },
  facebook: { color: "#1877F2", borderClass: "border-[#1877F2] hover:border-[#1877F2] hover:bg-[#1877F2]/10" },
  x: { color: "#000", borderClass: "border-gray-700 dark:border-gray-400 hover:border-gray-900 dark:hover:border-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800" },
  twitter: { color: "#000", borderClass: "border-gray-700 dark:border-gray-400 hover:border-gray-900 dark:hover:border-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800" },
  tiktok: { color: "#000", borderClass: "border-gray-700 dark:border-gray-400 hover:border-gray-900 dark:hover:border-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800" },
  gank: { color: "#E84C3D", borderClass: "border-[#E84C3D] hover:border-[#E84C3D] hover:bg-[#E84C3D]/10" },
  gumroad: { color: "#FF90E8", borderClass: "border-[#FF90E8] hover:border-[#FF90E8] hover:bg-[#FF90E8]/10" },
  paypal: { color: "#003087", borderClass: "border-[#003087] hover:border-[#003087] hover:bg-[#003087]/10" },
}

const socialIconPaths = {
  instagram: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z",
  facebook: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z",
  x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  twitter: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  tiktok: "M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z",
}

export function getSocialIcon(label) {
  const key = String(label || "").toLowerCase().replace(/\s/g, "")
  if (supportPlatforms[key]) return supportPlatforms[key]
  const match = Object.keys(socialIconPaths).find((k) => key === k || key.includes(k))
  if (!match) return null
  const platform = socialPlatforms[match] || socialPlatforms.instagram
  return {
    ...platform,
    Icon: () => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
        <path d={socialIconPaths[match]} />
      </svg>
    ),
  }
}
