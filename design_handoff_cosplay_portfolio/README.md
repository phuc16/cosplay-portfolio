# Handoff: Cosplay Portfolio — full site + full admin

## Overview
A single-artist cosplay portfolio ("Kamidayhehe") plus its admin console. The public
site is a dark, neon-pink themed page with an auto-rotating hero slideshow, a 3-column
info dashboard, a project/album gallery with lightbox, a contact/support section, a
first-visit event popup, and a decorative footer character cutout. The admin console
manages albums (CRUD + drag-reorder + drag-drop upload), bilingual site settings, hero
images/accent colors + optional cover image, upcoming events (with per-event popup image),
supports/socials, and a live color-scheme picker.

This handoff covers **the entire public site AND the entire admin** — not a single feature.

## About the design files
The files in this bundle are **design references authored in HTML/React (via CDN Babel)** —
prototypes that show the intended look, layout, and behavior. They are **not** production
code to drop in. Recreate them in the target codebase using its established patterns:

- **Target repo (already exists locally): `cosplay-portfolio/`**
  - Frontend: **React + Vite + Tailwind** (`frontend/src`)
  - Backend: **Node/Express + knex + MinIO** (`backend/`), settings persisted as a JSON
    blob in `site_settings.config`, images in `albums`/`images` tables, gallery cached in Redis.
- Rebuild the UI as React + Tailwind components matching the repo's conventions. Do not
  copy the inline-style objects verbatim — translate them to Tailwind classes / the repo's
  component library. Use the design tokens below as the source of truth for values.

## Fidelity
**High-fidelity (hifi).** Colors, typography scale, spacing, radii, shadows, and
interactions are final. Recreate pixel-faithfully, but express through Tailwind + the
repo's existing components rather than raw inline styles.

---

## Design tokens

All tokens live in `styles.css` → `tokens/*.css` (copied into this bundle). The repo already
mirrors most of these in `tailwind.config.js`. Key values:

### Color — brand (pink/rose)
- `--pink-300 #f9a8d4`, `--pink-400 #f472b6` (hover/glow), `--pink-500 #ec4899` (PRIMARY),
  `--pink-600 #db2777`, `--rose-400 #fb7185`, `--rose-600 #e11d48`

### Color — dark surfaces (the signature canvas; dark mode is the default look)
- `--cosplay-dark #0d0d14` (page bg), `--cosplay-darker #08080c` (footer/wells),
  `--cosplay-card #15151f` (cards), `--cosplay-border #2a2a3a` (hairlines)

### Semantic aliases
- **Dark mode** (`.dark` on `<html>`): bg-page `#0d0d14`, surface-card `#15151f`,
  border-default `#2a2a3a`, text-strong `--slate-100 #f1f5f9`, text-body `--slate-400 #94a3b8`,
  text-muted `--slate-500 #64748b`, text-link `--pink-400`, brand `--pink-500`.
- **Light mode** (default, no `.dark`): bg-page `#f9fafb`, surface-card `#fff`,
  border-default `#e5e7eb`, text-strong `#111827`, text-body `#4b5563`, text-link `--pink-500`.
- The app boots in **dark** mode; a nav toggle switches to light.

### Typography
- Family: system-UI sans stack (NO webfont): `ui-sans-serif, system-ui, -apple-system,
  "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`. Headings share it.
- Scale (px): xs 12, sm 14, base 16, lg 18, xl 20, 2xl 24, 3xl 30, 4xl 36. Hero title is 48px.
- Weights: 400/500/600/700/800. Line-heights: tight 1.15, snug 1.3, normal 1.5.

### Spacing — 4px grid
0, 4, 8, 12, 16, 20, 24, 32, 40, 48. Card padding 20px (sm) / 40px (lg) / 48px (hero).
Containers: narrow 56rem (about/contact/events), **wide 72rem / 1280px** (nav/hero/gallery/sections).
Page gutter: 32px desktop. Section gap: 28–80px (see per-section notes). Nav height 64px.

### Radii
sm 6px (buttons/inputs/chips), md 8px (cards/images), lg 12px (large cards/dialogs), full 9999px.

### Shadows / effects
- `--shadow-pink-glow: 0 0 20px rgba(236,72,153,.30)`
- `--shadow-pink-soft: 0 4px 14px rgba(236,72,153,.15)` (default card shadow)
- `--shadow-pink-hover: 0 20px 25px -5px rgba(236,72,153,.20), 0 8px 10px -6px rgba(236,72,153,.20)`
- Nav backdrop blur 16px; lightbox scrim `rgba(0,0,0,.92)`; modal scrim `rgba(0,0,0,.55)` + blur 6px.
- Transitions: fast 150ms, base 300ms, slow 700ms; ease-out `cubic-bezier(0,0,.2,1)`.

---

## Public site — screens & components

Global: sticky top nav (blurred), then Hero → Info dashboard (`#info`) → Project+Schedule
(`#project`) → Contact+Support (`#contact`) → Footer. A footer character cutout overlaps the
bottom-right. Lightbox and event popup are overlays. All sections are centered, `max-width 1280px`,
`padding 0 32px`.

### Navbar (sticky, height 64px, z-30)
- Left: 36×36 rounded-8 gradient mark (`linear-gradient(135deg, #ec4899, #e11d48)`, pink glow)
  with letter "C"; then artist name (600) + tagline caption (`text-xs`, muted).
- Center: nav links `Info/Project/Contact` (VI: `Thông tin/Dự án/Liên hệ`), `text-sm` 500,
  hover → text-link color.
- Right: VI/EN language segmented toggle (active = brand bg, white); theme toggle icon button
  (moon/sun) switching `.dark` on `<html>`.
- Background `color-mix(in srgb, var(--bg-page) 55%, transparent)` + `backdrop-blur 16px`.

### Hero banner (the primary work of this handoff)
- Container: `max-width 1280`, `padding 20px 32px 0`. Card is `height 500px`, `radius 12px`,
  `overflow: visible`, `box-shadow: 0 0 40px <glowColor>`.
- **Layer stack (bottom → top):**
  1. Card background: `linear-gradient(to right, <baseBg> 0%, <accent> 65%)` where baseBg is
     `#080810` (dark) / `#fff` (light) and `<accent>` is the current slide's accent color.
  2. **Cover image (optional, `heroCover`)** — `position:absolute; inset:0; object-fit:cover;
     object-position:center 25%; z-index:1`. Full-bleed backdrop. Omitted when not set.
  3. **Colored tint over the cover** (only when cover present) — same left→right gradient,
     `opacity:0.55; mix-blend-mode:multiply; z-index:2`. This keeps the per-slide accent
     readable on top of the photo.
  4. Dark left-scrim for text legibility (`s.grad`, z-index:3):
     `linear-gradient(90deg, rgba(13,13,20,.95) 0%, rgba(13,13,20,.75) 42%, rgba(13,13,20,.05) 100%)`.
  5. **Character pop-out** (z-index:35, `pointer-events:none`): the current slide image drawn
     large, overflowing the top of the card (`top:-84px`), with `drop-shadow(0 0 50–60px <glow>)`
     and a bottom fade mask `linear-gradient(to bottom, black 65%, transparent 100%)`.
     Portrait images (aspect < 1.2) anchor right at 55% width; landscape images center at 80% width.
  6. Text block (z-index:4, bottom-left, max-width 520, padding `0 48px 36px`): H1 title 48px/800
     with pink→rose gradient text clip; about paragraph (`slate-300`, 16px, lh 1.6); primary CTA
     button ("View Projects" / "Xem dự án") that smooth-scrolls to `#project`.
  7. Prev/next circular arrows (z-5, pink translucent) at left/right center; slide dots bottom-center
     (active dot widens to 20px, brand color).
- **Autoplay**: advances every 4000ms; wraps around. `heroImages[]` drives slides.
- **Accent color per slide**: extracted client-side from each image via a canvas dominant-color
  sampler (see "Color extraction" below), falling back to `heroThemes[i]`. In production the
  extracted color is stored (`heroImages[i].accentColor`) so the client can skip canvas work.

### Info dashboard (`#info`, padding `80px 32px 0`, 3 equal columns, gap 20)
Cards: surface-card, border-default, radius 12, padding 20, `shadow-pink-soft`.
- **Col 1 — Latest photos ("Ảnh mới nhất"/"Guest Banner")**: 2×2 grid of square thumbs
  (radius 8), hover scales image to 1.05, click opens lightbox; a full-width "View More" outline
  button below.
- **Col 2 — Info + Support**: section title in text-link color. Socials as a 2-col grid of
  bordered rows (icon + label + external-link glyph), each tinted to its brand color on hover.
  A divider, then "Support" heading and a vertical list of support links (Gumroad/Gank/PayPal),
  each row tinted to `support.color`.
- **Col 3 — Achievements ("Thành tựu")**: vertical list; each item = 28px round brand-soft
  badge with a star icon + title (600) + description (`text-xs` muted).

### Project + Schedule (`#project`, padding `28px 32px 0`, grid `1fr 300px`, gap 20)
- **Project card**: heading, 3-col grid of album cards. Album card = cover image `aspect 4/5`,
  a "+" pill top-right, footer with album title (600) + "N photos/ảnh" count. Hover lifts
  (`scale 1.02` + `shadow-pink-hover`). Click opens lightbox over that album's `items[]`.
- **Schedule card** (300px): heading + vertical list of upcoming events. Each row: brand dot +
  title (600) + date row with calendar icon (`text-xs` muted). Row links out (`url`), hover
  brand border + brand-soft bg. Empty state: "No upcoming events."

### Contact + Support (`#contact`, padding `28px 32px 48px`, 2 columns, gap 32)
One card (bottom border removed so the footer character can overlap). Left = Contact
(intro copy, Phone/Zalo + Email labeled links, then social buttons colored per platform,
fixed width 130px). Right = Support (intro + Gumroad/Gank/PayPal buttons colored per support).

### Footer
Top border, sunken bg, `© <year> <artistName>. All rights reserved.` left, an "Admin"
text button right (navigates to the admin console).

### Footer character cutout
A transparent portrait PNG (`footerChar`) absolutely positioned bottom-right, overlapping
the footer/contact (`height: calc(100% + 260px)`, z-40, `pointer-events:none`), with a
purple drop-shadow and a top-anchored bottom fade mask. A small 30px round **dismiss ("×")
button** (blurred translucent bg) sits over it; clicking hides the character for the session
(local component state `showFooterChar`).

### Lightbox (overlay, z-50)
Full-screen `rgba(0,0,0,.92)` scrim. Centered image (max 88vh/88vw, radius 8, pink glow).
Prev/next round buttons + dots when >1 photo. Close button top-right (brand circle).
Keyboard: Esc closes, ←/→ navigate. Click scrim closes; click image does not.

### Event popup (first-visit, z-60)
On load, finds the first `upcomingEvents[]` entry with `showPopup:true`; if that event's
`sessionStorage` key (`eventPopup_<index>`) is unset, shows a modal after 600ms. Modal:
surface-card, radius 12, max-width 420, pink glow. Content: "Announcement" heading,
**optional `event.imageUrl` image (16:9, radius 8) — the image shows ONLY in this popup, never
in the schedule list**, then event title (text-link), date (muted), a "View details" link
(when `url` is set and not `#`) and a Close button. Closing sets the sessionStorage key.

---

## Admin console — screens & components

Reached from the site footer/nav "Admin". Dark theme throughout. Two tabs after login:
**Albums** and **Cài đặt trang (Site settings)**. Uses the shared design-system `Button`.

### Login
Centered 380px card. Username + password fields (focus ring = brand + brand-soft glow),
optional error line, primary "Đăng nhập" button. Demo: any non-empty credentials authenticate.

### Albums tab (`max-width 56rem`)
- Header: "Quản lý Albums" + primary "＋ Thêm album".
- Add/Edit form (toggled): album name input + optional description textarea + Lưu/Hủy.
- Album list — **drag to reorder** (drag handle `⋮⋮`); each row: 44px cover thumb, title +
  photo count, "Quản lý ảnh"/"Đóng" toggle, edit, and delete (confirms, removes album+images).
- When an album is expanded: a responsive grid of its images, each with a remove ("×") button;
  images support **drag-to-reorder** and a **drag-drop / click upload** dropzone appends images.

### Site settings tab
- **Bilingual fields** (VI/EN): artist name, tagline, about (textareas).
- **Logo**: click/drop image picker with preview + remove.
- **Hero Slideshow**:
  - Per hero image = a "slot" row: thumbnail, filename, an **Auto/Manual** accent-color toggle,
    a color swatch (canvas-extracted in Auto, color-input in Manual), and a gradient preview.
  - A **"+ Kéo thả / thêm ảnh Hero"** dropzone appends hero images; each hero image thumb has a
    remove button.
  - **"Ảnh bìa (tùy chọn)" (optional cover image)** block: click/drop picker with preview,
    "Chọn ảnh"/"Đổi ảnh", and "Bỏ ảnh" (clear). Maps to `heroCover`. Leaving it empty means the
    hero shows only the accent gradient.
- **Events ("Sự kiện sắp tới")**: drag-to-reorder list. Each event: bilingual title, date, url,
  and a **"Hiển thị popup khi mở trang"** checkbox. When checked, an **event image uploader**
  (click/drop, preview, "Xóa ảnh") appears — this image is the popup image (`imageUrl`) and is
  shown ONLY in the popup, not in the public schedule list.
- **Contact/socials/supports**: phone, email, contact links (e.g. Zalo), social links list
  (platform/label/url), and support URLs (gumroad/gank/paypal).
- **Color Scheme picker**: pick Pink/Blue/Purple/Amber/Rose; applied live and saved to settings
  (visitors get it on next load).

---

## Interactions & behavior summary
- Hero autoplay 4s, wrap-around; manual prev/next resets nothing special; dots reflect index.
- Theme toggle sets `.dark` on `<html>`; site defaults to dark.
- Language toggle swaps VI/EN copy across nav + sections.
- Color scheme persists to `localStorage('colorScheme')` in the prototype → in production
  `PATCH /api/settings { config.colorScheme }` and applied via CSS vars on load.
- Event popup gated by `sessionStorage('eventPopup_<index>')`.
- Footer character dismiss is session/component state only.
- Lightbox keyboard nav (Esc/←/→).
- Album & event & image **drag-reorder**; drag-drop uploads.

## Color extraction (hero accent) — reference algorithm
Prototype samples an 80×80 canvas of each hero image, weights pixels by saturation
(`w = 0.1 + sat*6`), skips near-black/near-white and transparent pixels, averages to an RGB,
then boosts (`v*1.4`) for the accent and derives glow/base variants. Fallback `[100,60,180]`.
**Production recommendation:** compute once (server-side or on upload), store
`heroImages[i].accentColor`, and skip client canvas work.

---

## State management
- **Public (prototype `App`)**: `scheme`, `theme` (default "dark"), `lang` (default "en"),
  `lightbox {photos, idx}`, `showFooterChar`, `eventPopup {event, key}`. Hero holds `idx`,
  extracted `themes{}`, `aspects{}`.
- **Admin**: `authed`, `tab` (albums/settings), `scheme`, `albums[]` (each `{id,title,description,
  images[{id,src}]}`), form state, drag state (album/image/event), `heroSlots[]`, and the whole
  `settings` object (see API contract). All mutations are local in the prototype; wire to the
  API in production.

---

## API contract (target backend: Express + knex, settings = JSON blob)

Most fields are keys inside `site_settings.config` — adding a field usually needs **no migration**,
just a new key in the JSON. The repo already has the upload endpoints.

- `GET /api/settings` → `{ config: {...} }`. Read on load; build UI from `config`.
- `PUT /api/settings` (repo convention) / `PATCH /api/settings` → persist `config`.
- `GET /api/gallery` → albums with items; the site flattens items for "latest photos" and
  reads `albums[].{id,title,cover,count,items[]}`.
- Album/image CRUD endpoints (exist in repo) for the admin Albums tab; reorder persists order.
- Uploads (exist in repo): `POST /api/upload/hero`, `POST /api/upload/event-image`,
  `POST /api/upload/thumbnail`, plus logo/cover uploads (cover can reuse the hero/generic
  image upload; store the returned URL in `config.heroCover`).

### `config` shape (from the prototype `DATA` / admin `settings`)
```jsonc
{
  "colorScheme": "pink",                    // pink|blue|purple|amber|rose
  "artistName": "Kamidayhehe",              // admin stores {vi,en}
  "tagline": "Cosplayer • Prop Maker • Photographer Friend",
  "about": "…",                             // admin stores {vi,en}
  "heroImages": ["<url>", "…"],             // slideshow; each may carry accentColor
  "heroCover": "<url|''>",                  // OPTIONAL full-bleed hero cover (empty = none)
  "logoUrl": "<url|''>",
  "latestPhotos": ["<url>", "…"],           // or derived from gallery
  "upcomingEvents": [
    { "title": "…", "date": "Aug 15, 2026", "url": "#",
      "showPopup": true, "imageUrl": "<url|''>" }   // imageUrl shows ONLY in popup
  ],
  "achievements": [ { "title": "100+ Cosplays", "description": "…" } ],
  "contact": {
    "phone": "+84 …", "email": "hello@…",
    "contactLinks": [ { "type": "zalo", "value": "…" } ],
    "social": [ { "platform": "facebook", "label": "Facebook", "url": "…" } ],
    "supports": { "gumroad": "", "gank": "", "paypal": "" }
  },
  "footerChar": "<transparent-portrait-png-url>"
}
```
Supported social platforms (icons provided in prototype): facebook, instagram, page, x,
tiktok, discord. Supports: gumroad, gank (custom icon), paypal — each with a brand color.

---

## Assets
- Character/photo images are the artist's own uploads (served from the repo's MinIO/uploads).
  The prototype references files under `uploads/` and placeholder art under `assets/placeholders/`.
- SVG icons (moon, sun, chevrons, calendar, star, external-link) and social/brand glyphs are
  inline SVG in the prototype — reuse the repo's icon set or copy these paths.
- No webfonts — system sans stack only.
- Gank support icon: `assets/gank.png` (custom raster). Others are inline SVG.

## Files in this bundle
- `PROMPT.md` — **the master prompt to paste into Claude Code** (start here).
- `BACKEND_NOTES.md` — backend/integration notes for the Express + knex + MinIO repo.
- `README.md` — this document (self-sufficient spec).
- `standalone/portfolio_standalone.html` — the public site as a **single offline file** (open in any
  browser to see the exact design running, no server needed).
- `standalone/admin_standalone.html` — the admin console as a single offline file.
- `portfolio_reference.html` / `admin_reference.dc.html` — the original source references.
- `styles.css` + `tokens/` — the design tokens (colors, typography, spacing, effects, fonts).
- `screenshots/` — reference captures of the rendered design:
  - `01-portfolio-full-dark.png` — hero (with cover image behind gradient) + navbar
  - `03-dashboard.png` — hero character overlap into the info area
  - `04-project-schedule.png` — album gallery cards + schedule list
  - `05-contact-footer.png` — contact/support + footer + footer character cutout + Admin button
  - `07-admin-login.png` — admin login
  - `08-admin-albums.png` — admin Albums tab (list + reorder + manage/edit/delete)
  - `09-admin-album-images.png` — album image manager (dropzone + reorderable grid + remove)
  - `10-admin-settings-top.png` — settings: color-scheme picker, bilingual info, logo
  - `11-admin-hero-cover.png` — Hero Slideshow: accent slots, hero images, + optional cover picker
  - `12-admin-events.png` — events with per-event popup image uploader
  (Lightbox and event popup are overlays — see the spec sections above.)

> Note: the `.html`/`.dc.html` files are **references for reading**, not runnable drop-ins.
> `admin_reference.dc.html` depends on the design-system runtime and won't render standalone;
> read it for structure/behavior. Recreate everything as React + Tailwind in `cosplay-portfolio/`.
