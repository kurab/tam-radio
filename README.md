# Tám Radio

A personal, non-commercial daily Japanese audio programme about what Vietnamese Gen Z talk about.
Published at https://kurab.github.io/tam-radio/ every day at 07:00 Vietnam time.

This repository holds the public site only. It is generated from the private source repository (the collector, the
approval flow) by `deploy/site/sync.sh`; edit there, not here.

- `site/` — the player (static HTML, CSS, JS), the caster's outfit packs, the policy page.
- `build/assemble.py`, `.github/workflows/pages.yml` — the daily build: the site plus the episodes of the last 14
  days and their audio (kept outside git) plus share cards, deployed to GitHub Pages.
- `tools/share_card.py`, `tools/fonts/` (Noto Sans JP, SIL Open Font License 1.1) — the share cards.

Voice: COEIROINK:リリンちゃん. The player is based on myradio (MIT, `site/LICENSE-myradio`).
