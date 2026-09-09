# System Patterns

## Error handling
- **Backend:** every route wraps logic in `try/catch`; on failure logs `console.error("[TAG] Lỗi:", err)` and returns `res.status(5xx).json({ error: "server_error", message: "<Vietnamese user message>" })`. GET /settings has a graceful fallback to `DEFAULT_SETTINGS` on error. Validation returns `400 { error: "invalid_input", message }`.
- **Image processing helpers** (`processImage`, `extractAccentHex`) wrap in try/catch and return a safe fallback (e.g. `"#db2777"`) rather than throwing.
- **Frontend:** API calls use `.catch(() => fallback)` - Portfolio falls back to `SITE_CONFIG` when `/api/settings` fails, `[]` for gallery, so the page always renders.

## Logging convention
- Backend logs are tagged `[TAG]` in Vietnamese-ish, e.g. `[UPLOAD/HERO]`, `[GALLERY]`, `[SETTINGS]`, `[WORKER]`, `[SERVER]`. Request logger prints `[ISO] METHOD path → status (Nms)`.

## Data / config pattern
- All site content is one JSON blob in `site_settings.config`. Reads merge `{...DEFAULT_SETTINGS, ...config}`; writes go through `sanitizeSettings` (an **allowlist** `ALLOWED_SETTINGS_KEYS` + array/string coercion). Any write to settings/albums/images calls `redis.del("settings")` / `redis.del("gallery")` to invalidate cache.
- Localized fields are `{vi,en}` objects. Frontend resolves with `getLocalized(obj, lang)` (string | {vi,en} | null → string, never throws, returns `""` when empty). **Never render a `{vi,en}` object directly** and never fall back to the raw object (`getLocalized(x) || x` is a bug - caused a blank-page crash, React error #31).
- Admin (`AdminSettings.jsx`) normalizes config on load with `toLocalizedObj` (wraps plain strings → `{vi,en}`) so old single-language data auto-migrates.

## Hero accent color (important)
- Computed **once server-side at upload** (`extractAccentHex` in `server.js`), returned as `accentColor` from `/api/upload/hero` + `/api/upload/thumbnail`, stored in `config.heroAccents[i].color`. Client just reads it - **no client canvas**.
- Formula MUST match the design (`portfolio_standalone.html` `extractDominantColor` + `colorToTheme`): saturation-weighted dominant (`a>100`, `br 20–235`, `w=0.1+sat*6`) then `boost ×1.4` → soft pastels. Do NOT use node-vibrant or HSL-normalization (rejected as garish).
- Backfill existing images by recomputing from stored URLs via `storage.getBuffer` (run in the backend container). Watch out: an admin **Save** re-persists whatever accents were loaded, so reload admin after a backfill.

## CSS-var-in-string gotcha
- Inline hover/tint styles concat hex alpha like `` `${col}60` `` / `` `${col}10` ``. This ONLY works for hex colors. A CSS var (`var(--x)`) becomes `var(--x)60` → invalid → the border/bg silently doesn't render. Use hex for any color that feeds these concats (e.g. X/TikTok = `#94a3b8`).

## Migrations / startup
- `entrypoint.sh` retries `knex migrate:latest` until MySQL accepts connections (fixed a fixed-`sleep 5` race that left tables uncreated), then `seed || continue`, then `node server.js`.

## Testing
- No automated test suite (backend `npm test` is a placeholder). Verification is: `npm run build` + `npm run lint` (frontend), `node -c` syntax check (backend), then deploy + headless-Chrome screenshot against the design screenshots in `design_handoff_cosplay_portfolio/screenshots/`.
