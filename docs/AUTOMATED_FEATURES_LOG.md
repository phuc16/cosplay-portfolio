# Automated Features Log

Record of features shipped (or abandoned) by the daily autonomous
feature-growth agent. Each entry: date, slug, branch, PR URL, trend angle,
one-line description. Read this before picking new features so we never
duplicate past work. Note: this log only ever gets committed on feature
branches, which may not be merged yet - check open PRs directly too (see
`mcp__github__list_pull_requests`), don't rely on this file alone.

**IMPORTANT for future runs:** this log is unreliable across days because
entries only live on unmerged feature branches - always call
`mcp__github__list_pull_requests` (state=open) and read every open PR's
title/body BEFORE picking a feature, don't rely on this file alone.

| Date | Slug | Branch | PR | Trend angle | Description |
|---|---|---|---|---|---|
| 2026-09-20 | artist-credit | feature/auto-artist-credit | https://github.com/phuc16/cosplay-portfolio/pull/17 | Cosplay-community trend | Free-text artist/photographer credit line per product, publicly displayed |
| 2026-09-20 | searchableselect-a11y (ABANDONED - duplicate of #10) | - | closed, see PR #13 | Tech trend | Duplicated pre-existing open PR #10; discovered via open-PR audit, not visible in this log since #10 was never merged |
| 2026-09-20 | discount-codes (ABANDONED - duplicate of #8) | - | closed, see PR #14 | Shopping/e-commerce trend | Duplicated pre-existing open PR #8; discovered via open-PR audit, not visible in this log since #8 was never merged |
| 2026-09-20 | product-tags/character-tags (ABANDONED - duplicate of #12) | feature/auto-product-tags (no PR opened) | - | Cosplay-community trend | Duplicated pre-existing open PR #12; discovered via open-PR audit before a PR was opened |
