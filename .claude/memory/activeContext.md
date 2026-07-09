# Active Context
Last updated: 2026-07-09 (security/infra hardening batch)

## Current Task
Security & infra hardening (user declined backups):
- [x] Hero cutout white-frame fix: drop-shadow → radial aura behind img (same root cause as footer; tight-crop cutouts)
- [x] docker-compose.yml (dev): sensitive ports bound to 127.0.0.1, restart unless-stopped, log rotation 10m×3
- [x] Created docker-compose.pull.yml (prod, was missing from repo): NO public ports except frontend on 127.0.0.1:5173; secrets required via :?; log rotation; unless-stopped
- [x] Login: crypto.timingSafeEqual (sha256 both sides) for username+password compare
- [x] Backend request logs → structured JSON one-line (ts, level, method, path, status, ip, latency, bytes_in/out, user_agent, referer)
- [x] npm audit fix backend+frontend → 0 vulnerabilities
- [x] Lazy-load images (latest photos, album covers, footer char)
- [x] Security headers in frontend/nginx.conf (HSTS, XFO, nosniff, referrer-policy, permissions-policy, CSP) — verified live on prod
- [x] Cloudflare active on kamidayhehe.com (Namecheap NS → amanda/matias.ns.cloudflare.com); CDN cache verified (webp HIT, /api DYNAMIC); user set Full (strict) + Always Use HTTPS
- [x] Anti-download deterrent: img right-click blocked (Portfolio root onContextMenu), CSS user-drag/select/touch-callout none
- [x] Cloudflare active + verified live: A records → CF IPs, server: cloudflare, HTTP/2, security headers live, CDN cache webp MISS→HIT, /api DYNAMIC
- [x] DEPLOY.md updated: Cloudflare flow (Bước 2), pull.yml security notes (Bước 7), structured-log viewing, troubleshooting (redirect loop / 526 / cf-cache-status / missing .env)
- [ ] User to flip ON: Cloudflare Scrape Shield → Hotlink Protection
- [ ] User: ufw on droplet (allow only 22/80/443) + deploy new pull.yml with --force-recreate + rebuild/push backend & frontend images (timing-safe login, JSON logs, anti-download, lazy-load)

## Prior task (done): UI polish batch
UI polish batch (all built OK, awaiting user's prod deploy to kamidayhehe.com):
- [x] Footer-char purple frame fix: drop-shadow → radial-gradient aura behind img
- [x] Footer-char bottom mask removed (caused horizontal band over footer text)
- [x] Contact/footer: removed social-buttons grid + Gank; supports vertical on web/tablet, horizontal on mobile (.support-row @≤760px)
- [x] PayPal color → #a2cffe (was #003087, invisible on dark)
- [x] Mobile hero: card height 300px; cutout stays right + pops only 18px (never covers VI/EN)
- [x] Footer line bilingual (VI "Bảo lưu mọi quyền.") + right side "Made with ♥ · Admin" (sits under footer char; shows when char hidden)
- [x] Hero cover image sizing advice given: one 2560×1080 WebP, face in center-50%/upper half (object-fit cover crops sides on mobile)
- [x] Mobile footer: stacked + centered lines, Admin button hidden (≤760px, .footer-bar/.footer-admin) — fixed ugly wrap
- PARKED (not accepted): change hero cutout fit to height-based bottom-right anchor (would let one 5:8 cutout image fit all breakpoints) — user was asking about cover, not cutout

## Prior task: Add motion: (1) hero cutout slide-in (direction-aware), (2) subtle scroll-reveal (fade + rise) on Info/Project/Contact sections.

## Exactly Where I Am (animation task)
- [x] Hero: `dir` state; `advance(d)` sets direction; portrait cutout uses `hero-slide-r/l`, landscape uses centered `hero-slide-cr/cl` (keep translateX(-50%)); keyframes added to index.css
- [x] `Reveal` component (IntersectionObserver, once, honours prefers-reduced-motion); wraps Info/Project/Contact; `.reveal`/`.reveal.in` CSS added (fade + translateY 22px)
- [x] Build + deploy frontend (ships both) — done by user (they run builds themselves)
- [x] User verifies

## Prior task (done): Contact section — hide raw phone; show quick-contact buttons Zalo / WhatsApp / Messenger + Gmail (with logos); email stays public.

## Exactly Where I Am (contact task)
- [x] Public: removed phone-number display; email text kept; added quick-contact button row from `data.contact.quick`
- [x] `buildData.contact` = `{ email, quick }`; quick = contactLinks (zalo/whatsapp/messenger) + Gmail(email); legacy `phone` auto-migrates to a Zalo button (number not shown)
- [x] Icons: Zalo + Gmail real/logo (`/refassets/zalo.png`, Gmail SVG), WhatsApp + Messenger SVGs; `CONTACT_META` + `contactHref()` helper
- [x] Admin: removed phone input; contactLinks types → Zalo/WhatsApp/Messenger (dropped Gmail — comes from email field); email field labeled "hiện công khai + nút Gmail"
- [x] Build + deploy (zalo.png bundled + served)
- [x] Messenger available as a contactLinks type in admin (dropdown Zalo/WhatsApp/Messenger); user enters the link themselves — do NOT seed it (they said "link tự admin nhập")
- [x] User to verify + add WhatsApp/Messenger links in admin if wanted

## Prior task: Image perf — serve uploads as WebP to fix slow first-load of heavy hero PNGs (~5MB each).

## Exactly Where I Am (WebP task)
- [x] `processImage` (server.js) → always WebP (quality 82); replaces PNG/JPEG branch (keeps alpha)
- [x] Worker thumbnails → WebP (quality 80)
- [x] Storage proxy Cache-Control → `public, max-age=31536000, immutable`
- [x] Deployed backend + worker; verified upload returns `.webp`
- [ ] User to re-upload the 3 existing hero PNGs (kept as-is per request; not backfilled) to get WebP benefit

## Prior task: Make the event/schedule URL optional (no HTML5 "Please enter a URL" required-validation); when empty the schedule item is simply not clickable.

## Exactly Where I Am (current task)
- [x] Admin event URL input: `type="url"` → `type="text"` (placeholder "Link sự kiện (tùy chọn)…")
- [x] Seed defaults: event `url: "#"` → `url: ""` (config.js + server.js)
- [x] Public schedule row: render `<a>` only when a real URL exists (`ev.url && ev.url !== "#"`), else non-clickable `<div>` (cursor default, no hover)
- [x] Build + lint + deploy frontend + verify (event URL now optional)

## Also done (this session)
- [x] Latest photos: admin upload section (`config.latestPhotos`) + public reads it (config → gallery → hero); backend allowlist + sanitize
- [x] Theme default dark: `index.html` now `<html lang="en" class="dark">` (no light flash; contexts already default dark)
- [x] Language default en (already; confirmed in LanguageContext)

## Prior task (done): Reproduce the design (public + admin) matching screenshots, polish hero/theme/i18n

## Exactly Where I Am
- [x] Public site rebuilt as faithful reproduction (`Portfolio.jsx`): dark default, pink brand, hero cutout pop-out, Info/Project/Contact/Footer, lightbox, event popup
- [x] Full design tokens ported into `index.css`; `applyColorScheme` extended
- [x] Backend + config seeded (`DEFAULT_SETTINGS`, `SITE_CONFIG`); entrypoint migrate-retry fix
- [x] Image uploads preserve transparency (PNG when alpha) — backend `processImage` + worker
- [x] Hero accent computed server-side at upload via design's exact formula (`extractDominantColor` + boost ×1.4 → pastels); no client canvas; backfilled existing images
- [x] Hero gradient tuned: soft pastel accent right, reduced dark scrim left + faint accent tint
- [x] Admin: achievements bilingual (VI/EN); event date bilingual + even-width row
- [x] X/TikTok icons → grey `#94a3b8` with border (hex so tint concats resolve)
- [x] Gank logo added (real favicon → `/refassets/gank.png`) in Support
- [x] Fixed blank-page crash (React #31): removed `getLocalized(x) || x` raw-object fallback
- [x] Dead code removed earlier; design folder was deleted then re-copied by user (still present)

## Current File Being Worked On
[none in-flight — hardening batch code complete; backend/server.js, compose files, frontend/nginx.conf, deploy/DEPLOY.md all edited & verified]

## Immediate Next Step
User: (1) rebuild+push backend & frontend images (`./scripts/build-push.sh`), deploy with new docker-compose.pull.yml `--force-recreate`; (2) ufw allow only 22/80/443; (3) Cloudflare Scrape Shield → Hotlink Protection ON. Then commit working tree. User still designing hero-cover image (2560×1080 spec).
NOTE: user prefers to self-verify in the browser — do NOT auto-run headless screenshots. Do NOT seed contact data into config — user enters links in admin.

## Blockers / Open Questions
- Existing hero accents can be overwritten if admin is Saved with stale (pre-backfill) values — reload admin before saving.
- Large uncommitted working tree (reproduction + fixes + `node-vibrant` added then removed); not yet committed.
