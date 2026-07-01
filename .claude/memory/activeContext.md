# Active Context
Last updated: 2026-07-02 (task complete)

## Current Task
Reproduce the design (`design_handoff_cosplay_portfolio/`) in the app — public site + admin — matching screenshots exactly, and polish hero/theme/i18n per user feedback.

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
[none — session wrapped; all changes deployed on :5173]

## Immediate Next Step
Decide commit strategy (single squashed commit vs. split into ~5 logical commits) and commit the working tree. Then optionally re-verify remaining screens against `design_handoff_cosplay_portfolio/screenshots/`.

## Blockers / Open Questions
- Existing hero accents can be overwritten if admin is Saved with stale (pre-backfill) values — reload admin before saving.
- Large uncommitted working tree (reproduction + fixes + `node-vibrant` added then removed); not yet committed.
