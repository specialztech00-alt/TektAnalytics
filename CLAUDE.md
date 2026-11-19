# TektAnalytics — rules for every session

## Project goal
TektAnalytics is a sourced, dated record of Nigerian construction material prices
that grows into decision tools. The prototype will be shown to a potential investor,
so it must be real, honest and working. Every number shown must trace back to a
real source page that the owner (Peculiar) has checked.

## Non-negotiable rules
1. **NEVER invent data.** Every price in `data/prices.csv` comes from a real source
   that the owner (Peculiar) has checked: a source page, or (for
   `quote_type=market_quote` only) a supplier quote by phone, WhatsApp or visit,
   with the supplier named and the notes saying how it was quoted. An assistant
   may not add rows to `prices.csv` itself. Only the owner adds rows, after
   checking the source.
2. **Sample data lives only in `data/prices.sample.csv`.** It must use obviously fake
   item names and sources (e.g. "Demo Material A", source "Demo Source - not real",
   source_url `https://demo.invalid/`) so it cannot be mistaken for a real source or
   attributed to a real company. Never use the names of real companies or websites
   in the sample file.
3. **Sample data must NEVER load silently.** The build only uses the sample file when
   run with the explicit `--sample` flag. If `data/prices.csv` has no data rows, the
   normal build must fail with a clear message, not fall back to the sample. Any page
   that shows sample data must show the banner
   **"ILLUSTRATIVE DEMO DATA - NOT REAL PRICES"**.
4. **No frameworks.** Plain HTML, CSS and vanilla JS only (Tailwind via a pinned CDN
   is allowed later). Python scripts use the standard library only.
5. **Do not delete or overwrite any file the owner did not ask you to touch.** If you
   want to delete something, ask first.
6. **Never read, create or edit `.env` files or secrets.**
7. **Work in small steps.** Stop at the end of each phase, list every file created,
   explain how to run and check it, and wait for approval before the next phase.

## Working habits
- After every phase, append a dated, plain-language entry to `docs/BUILD_LOG.md`
  (the owner is learning and journals from it).
- Scope is defined in `docs/SCOPE.md`. Do not build out-of-scope features.
- Before committing data changes, run `python scripts/validate.py`.
