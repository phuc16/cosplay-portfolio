# MASTER PROMPT — paste this to Claude Code inside the `cosplay-portfolio/` repo

Put the `design_handoff_cosplay_portfolio/` folder inside the repo first. Then paste everything
between the lines as your first message. This prompt assumes a PREVIOUS attempt already exists and
is WRONG — your job is to make the app match the reference design pixel-for-pixel.

--------------------------------------------------------------------------------
You are re-implementing a design in THIS repo (`cosplay-portfolio/`). A previous attempt is badly
off. Do not defend or extend it — bring the app to match the reference EXACTLY.

## THE SINGLE SOURCE OF TRUTH
Open `design_handoff_cosplay_portfolio/standalone/portfolio_standalone.html` and
`.../standalone/admin_standalone.html` directly in a browser. These are the exact target, running,
offline. Your output must look and behave identically. When anything is ambiguous, the standalone
file wins — over your assumptions, over the current repo, over the framework defaults.
Also read: `README.md` (spec), `BACKEND_NOTES.md` (data/API), `screenshots/*.png` (targets),
`styles.css` + `tokens/` (authoritative token values).

## STACK (already in the repo — match its conventions, don't re-scaffold)
Frontend React + Vite + Tailwind (`frontend/src`); backend Node/Express + knex + MinIO (`backend/`);
site content persists as a JSON blob in `site_settings.config`. Recreate the reference UI as
React + Tailwind — translate inline styles to Tailwind/existing components; do NOT paste inline styles.

## CURRENT DEFECTS — every one of these MUST be fixed (verified against the reference)
1. App renders in LIGHT mode. → Default theme must be DARK.
2. Brand color is BLUE everywhere (headings, links, buttons, nav active pill, dots, star badges,
   hero title). → Brand is PINK. Nothing brand-related may be blue.
3. Hero character sits in a separate BLACK box on the right half. → Wrong. The hero is ONE card;
   the character is a pop-out overlapping the top; the cover image is full-bleed behind the gradient.
4. Cards are white/light with faint borders. → Cards must be dark `#15151f` with `#2a2a3a` borders.
5. "Info" card is EMPTY. → Must show socials grid + Support links.
6. "Latest photos" shows "No photos yet". → Must load photos from the gallery.
7. "Project" shows "No albums yet". → Must load albums from `GET /api/gallery`.
8. "Support" shows "Not configured". → Must render support links (Gumroad/Gank/PayPal).
9. Footer character cutout is MISSING. → Must render (with dismiss "×").
10. Star/achievement badges and schedule dots are blue. → Pink brand-soft badges, pink dots.

## TOKENS (authoritative — wire into Tailwind theme / CSS vars)
- Dark surfaces: page `#0d0d14`, card `#15151f`, well/footer `#08080c`, border `#2a2a3a`.
- Text (dark): strong `#f1f5f9`, body `#94a3b8`, muted `#64748b`.
- Brand pink: primary `#ec4899`, hover/glow `#f472b6`, deep `#db2777`; rose `#fb7185`/`#e11d48`.
- Hero title gradient text: `#ec4899 → #e11d48`. Links/CTAs/active dots/focus rings: pink.
- Radii: sm 6 (btn/input/chip), md 8 (card/img), lg 12 (big card/dialog), full 9999.
- Shadows: soft `0 4px 14px rgba(236,72,153,.15)`, glow `0 0 20px rgba(236,72,153,.30)`,
  hover `0 20px 25px -5px rgba(236,72,153,.20), 0 8px 10px -6px rgba(236,72,153,.20)`.
- Type: system sans (no webfont). Sizes px: xs12 sm14 base16 lg18 xl20 2xl24 3xl30 4xl36; hero H1 48.
- Spacing 4px grid; page gutter 32; container wide 1280 / narrow 56rem; nav height 64.
- `config.colorScheme` default = `"pink"`. Check `tailwind.config.js` does NOT alias brand to blue.

## PUBLIC SITE — build every screen (match reference exactly)
- **Navbar** (sticky, 64px, backdrop-blur 16px, translucent): 36×36 rounded-8 pink-gradient mark
  with "C" + pink glow; artist name (600) + tagline caption (xs, muted); center links Info/Project/
  Contact (VI: Thông tin/Dự án/Liên hệ); right VI/EN segmented toggle (active = pink bg, white) +
  moon/sun theme toggle.
- **Hero** — the exact layer stack, ONE card `height:500px; radius:12px; overflow:visible`:
  (a) background `linear-gradient(to right, <baseBg> 0%, <accent> 65%)`;
  (b) optional cover `heroCover` `absolute inset:0; object-fit:cover; object-position:center 25%`;
  (c) accent tint over cover `opacity:.55; mix-blend-mode:multiply`;
  (d) dark left scrim for text legibility;
  (e) the current slide's character image as a POP-OUT overflowing the card TOP (drop-shadow +
      bottom fade mask) — NOT boxed on the right;
  (f) bottom-left: H1 (48/800, pink→rose gradient text) + about (16, slate-300) + pink CTA
      "View Projects"/"Xem dự án" that scrolls to #project;
  (g) prev/next round pink arrows + slide dots (active dot widens, pink). Autoplay 4000ms, wraps.
  Accent per slide is extracted from the image (see README algorithm) or from stored accentColor.
- **Info dashboard** (`#info`, 3 equal columns, gap 20, dark cards): col1 Latest photos 2×2 square
  grid (hover-zoom, click→lightbox) + "View More" outline btn; col2 Info (socials 2-col bordered
  rows, each tinted to its brand color on hover) + divider + Support links (tinted per support);
  col3 Achievements list (28px pink-soft round badge w/ star + title 600 + xs muted desc).
- **Project + Schedule** (`#project`, grid `1fr 300px`): Project card = 3-col album grid, album =
  cover `aspect 4/5` + "+" pill + title(600) + "N photos" count, hover lift + pink glow shadow,
  click→lightbox of that album. Schedule card = event rows (pink dot + title + calendar-icon date,
  xs muted), row links out, hover pink border.
- **Contact + Support** (`#contact`, 2 columns): Contact (intro, Phone/Zalo + Email links, social
  buttons colored per platform, fixed 130px) | Support (intro + Gumroad/Gank/PayPal buttons).
- **Footer**: top border, sunken bg, `© <year> <name>. All rights reserved.` + "Admin" link.
- **Footer character cutout**: transparent PNG `footerChar` absolute bottom-right, overlapping
  contact/footer (`height: calc(100% + 260px)`, pointer-events none, purple drop-shadow, top fade
  mask) + a 30px round translucent dismiss "×" (hides for the session).
- **Lightbox** overlay (z-50, scrim rgba(0,0,0,.92)): centered image (max 88vh/vw, pink glow),
  prev/next + dots when >1, close button, keyboard Esc/←/→, click-scrim closes.
- **Event popup** (first visit, z-60): first `upcomingEvents` with `showPopup:true`; gated by
  `sessionStorage('eventPopup_<index>')`; shows optional `event.imageUrl` (16:9) — image ONLY here,
  never in the schedule list — plus title, date, "View details" link, Close.
- Bilingual VI/EN across nav + all sections.

## ADMIN CONSOLE — build every screen (match `admin_standalone.html`)
Login (380px card, pink focus ring, demo: any non-empty creds) → tabs Albums + Site settings.
- **Albums**: header + "＋ Thêm album"; add/edit form (name + optional description); list with
  drag-reorder (⋮⋮ handle), cover thumb, title + photo count, "Quản lý ảnh"/"Đóng", edit, delete
  (confirm); expanded album = image grid with remove ×, drag-reorder, drag-drop/click upload.
- **Site settings**: bilingual name/tagline/about; logo picker; Hero Slideshow (per-image slot:
  thumb + Auto/Manual accent toggle + swatch + gradient preview; "+ add hero" dropzone; remove per
  image) + "Ảnh bìa (tùy chọn)" cover picker (choose/change/clear → `heroCover`, empty = gradient
  only); Events (drag-reorder; bilingual title/date/url; "Hiển thị popup khi mở trang" checkbox →
  reveals event image uploader → `imageUrl`, popup-only); contact/socials/supports; live
  color-scheme picker (Pink default / Blue / Purple / Amber / Rose).

## BACKEND / DATA (see BACKEND_NOTES.md + README "API contract")
- `GET /api/settings` → `{ config }`; `PUT /api/settings` persists it. New fields are new KEYS in
  the `config` JSON — NO migration unless a truly new table/column is needed.
- `GET /api/gallery` (Redis-cached) feeds the gallery AND latest-photos; invalidate on mutation.
- Reuse uploads: `POST /api/upload/hero`, `/api/upload/event-image`, `/api/upload/thumbnail`;
  cover reuses a generic/hero upload, store URL in `config.heroCover`.
- `config` keys the UI reads: `colorScheme, artistName{vi,en}, tagline{vi,en}, about{vi,en},
  heroImages[](+accentColor), heroCover, logoUrl, upcomingEvents[]{title,date,url,showPopup,imageUrl},
  achievements[], contact{phone,email,contactLinks[],social[],supports{gumroad,gank,paypal}}, footerChar`.
- Seed `config` so the site is NOT empty on first load (name, tagline, about, at least the sample
  hero images, achievements, events, socials/supports) — the reference is fully populated.
- Session-only (never server-persist): theme, language, lightbox, footer-char dismiss, event-popup seen.

## METHOD — do this in order, confirm with me between phases
1. SURVEY the repo; list exact files to create/modify (frontend + backend) and the token→Tailwind
   map. Wait for my OK.
2. TOKENS/THEME: dark default + pink brand wired into Tailwind/CSS vars. Post a screenshot proving
   bg is dark `#0d0d14` and brand is pink BEFORE continuing.
3. PUBLIC components → assemble public page → match `screenshots/01,03,04,05` and the standalone.
4. ADMIN → match `screenshots/07–12` and the admin standalone.
5. BACKEND: add missing `config` keys/endpoints; wire gallery + settings + uploads; seed config.
6. After each phase: build + lint, fix all errors. At the END, screenshot every screen and diff
   against the standalone files + `screenshots/`, and report any remaining visual gap.

Rules: never leave the app in light mode or with blue brand. Never ship empty Info/Project/Support
/photos. If a feature already exists in the repo (e.g. event popup image), UPDATE it to match — do
not duplicate. Do not change the design; reproduce it.
--------------------------------------------------------------------------------
