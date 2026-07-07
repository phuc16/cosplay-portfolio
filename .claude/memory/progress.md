# Progress & Decisions

## Decisions Made

- **Public site as a single self-contained `Portfolio.jsx`** (all sub-components inline) → Why: faithful, low-drift reproduction of the design standalone (rule: standalone wins); avoids coordinating 8 files. Alternatives rejected: keeping the split component files (more files to keep in sync during a pixel-faithful rewrite).
- **Full design tokens in `index.css` as CSS vars** (light `:root` + `.dark`) → Why: the reference is entirely CSS-var driven; the repo previously defined only a subset so var-based styles collapsed. Alternative rejected: translating every inline style to Tailwind (higher drift risk vs. the standalone).
- **Preserve transparency on upload (PNG when `meta.hasAlpha`)** → Why: forcing `.jpeg()` flattened tách-nền PNGs to a black background ("black box" bug). Alternative rejected: keeping JPEG-only (breaks transparent cutouts).
- **Hero accent computed once server-side at upload, stored in config** → Why: user wanted no client-side canvas and no recompute per page load (BACKEND_NOTES preferred path). Client just reads `heroAccents[i].color`.
- **Accent formula = the design's exact `extractDominantColor` + `colorToTheme` (boost ×1.4)** → Why: produces soft pastels matching the design screenshots. Alternatives rejected: node-vibrant palette and HSL-normalization — both looked garish/saturated ("xấu"); node-vibrant also removed as a dependency.
- **X/TikTok icon color = hex `#94a3b8` (not `var(--text-strong)`)** → Why: neutral grey visible on both themes AND the inline tint concats `${col}60`/`${col}10` only resolve for hex (a CSS var → `var(--x)60` invalid → border/box silently missing).
- **`entrypoint.sh` retries `knex migrate:latest` until MySQL is up** → Why: fixed `sleep 5` was too short → migrations failed → tables never created ("table doesn't exist" 500s).

- **Serve all uploads as WebP (quality 82 / 80 thumbs), not PNG/JPEG** → Why: hero cutouts were ~5MB PNG each (~15MB first load); WebP is ~10-15× smaller (alpha kept) and ~25-35% smaller than JPEG. Storage proxy cache set to `immutable` for repeat visits. Alternative rejected: **Redis-caching image bytes** — doesn't shrink the browser transfer (the real bottleneck), only speeds the already-fast MinIO fetch, and bloats RAM / evicts the settings+gallery cache. Existing images left as-is (user opted not to backfill; re-upload to convert).

- **Footer character glow: radial-gradient behind, NOT `drop-shadow` on the image** → Why: the design/standalone used `filter: drop-shadow(0 8px 48px rgba(180,120,255,0.45))`, which traces the image's opaque alpha. It looks like a soft halo ONLY when the cutout has transparent padding around the subject (the design's PNG did). A tightly-cropped cutout (subject fills the frame, e.g. bbox ≈ full 1694×4094) makes the shadow a **rectangle = purple frame**. Replaced with a blurred radial-gradient ellipse behind the img (`inset:-40px -30px 40px`, no straight edges) so any crop looks clean. Deviates from standalone deliberately — standalone only looks right with a padded image; users upload tight crops. User picked this over "re-export padded images".

- **Contact footer: no social grid, no Gank; supports vertical desktop / horizontal mobile** → Why: user request; socials remain in the Info card. Mobile = ≤760px via `.support-row` class (inline styles can't do media queries).
- **PayPal color `#a2cffe`** → Why: brand `#003087` then `#009cde` rejected; user picked baby blue for dark-theme visibility.
- **Mobile hero (≤760px): card 300px; cutout keeps right-side pop but `top:-18px`** → Why: -84px covered the navbar VI/EN switch; card sits 20px below navbar so 18px stays inside the gap. First attempt (full-width cutout behind text) rejected — user wanted the pop-out look kept.
- **Footer: bilingual copyright + "Made with ♥ · Admin" under the footer char; mobile stacks centered and hides Admin** (`.footer-bar`/`.footer-admin` ≤760px) → Why: two-side layout wrapped badly on narrow screens.
- **Footer char: removed bottom mask fade** → Why: the 6% fade strip over the dark footer read as a horizontal band.
- **Hero cover spec for the user's designer: one 2560×1080 WebP** (2x of 1216×500), face inside center-50% width / upper half — `object-fit: cover` shows only the middle ~half on phones. Cutout images can NOT fit all breakpoints exactly (zone ratios 0.62–1.15); height-based-fit CSS change offered but parked.
- **Security posture (reviewed, no change): login lock 5 fails/15min per IP (Redis); rate limits global 600 / public 120 / storage 300 per min. NOT real DDoS protection — recommend Cloudflare free proxy; ensure backend port not public and Nginx overwrites X-Forwarded-For (keyGen trusts it).**

## What Didn't Work
- **Full-width under-text cutout on mobile** — first fix for the cutout covering VI/EN moved it behind the text as a backdrop; user wanted the right-side pop-out kept, only lower (`top:-18px`).
- **Footer char bottom mask fade** — drew a horizontal band where the semi-transparent strip crossed the dark footer; removed.
- **`node-vibrant` + HSL normalization for hero accent** — produced saturated mid-tone colors (gold/blue/red) the user called ugly; replaced with the design's boost-×1.4 formula (pastels). Dependency removed.
- **Hard right-weighted accent wash at 90% opacity** — looked garish with saturated colors; softened once colors became pastel.
- **`getLocalized(x, lang) || x` fallback in `buildData`** — when a localized field was empty (`{vi:"",en:""}`), `getLocalized` returns `""` (falsy) → fell back to the raw `{vi,en}` object → React error #31 (object as child) → blank page. Fix: use `getLocalized(...)` alone (always returns a string).
- **Server-side accent backfill got silently reverted** — an admin Save re-persisted the pre-backfill (node-vibrant) accents; had to re-run backfill and note "reload admin before saving".
- **`docker exec` heredoc without `-i`** — wrote an empty file (stdin not forwarded); use `docker exec -i`. Also `/tmp/script.js` can't `require("./db")` — must run from `/app`.
