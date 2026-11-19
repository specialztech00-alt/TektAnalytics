# TektAnalytics — prototype scope

## Purpose
TektAnalytics is a sourced, dated record of Nigerian construction material prices
that grows into decision tools. The prototype exists to show a potential investor a
real, honest, working product: every price shown traces back to a checked source.

## In scope for the prototype
- **Real price index**: 8–10 construction materials in 2 cities, each price
  sourced and dated.
- **Data-driven dashboard**: price history per material and region, generated from
  `site/prices.json`.
- **Browser-based basket pricer**: the user picks materials and quantities and gets
  an estimated cost from the latest sourced prices, computed in the browser.
- **Supporting pages**: Methodology, About, and a pilot-request page.

## Out of scope until after the investor demo
- User accounts / login
- Database
- Backend server
- Price alerts
- Supplier benchmarking
- Forecasts
- Scraping or automated agents collecting prices
- TektSupply / TektMaterials integration

## Rules
1. NEVER invent data. Every price in `data/prices.csv` comes from a real source the
   owner (Peculiar) has checked: a source page, or a named supplier's quote by phone,
   WhatsApp or visit (`quote_type=market_quote`, with how it was quoted in the notes).
2. Sample data lives only in `data/prices.sample.csv`, with obviously fake names and
   sources, and never names real companies or websites.
3. Sample data never loads silently. It is used only with the explicit `--sample` flag,
   the normal build fails if `prices.csv` is empty, and any page showing sample data
   displays "ILLUSTRATIVE DEMO DATA - NOT REAL PRICES".
4. No frameworks: plain HTML, CSS, vanilla JS (pinned-CDN Tailwind allowed later),
   and standard-library Python.
5. Do not delete or overwrite files the owner did not ask to change. Ask first.
6. Never read, create or edit `.env` files or secrets.
7. Work in small phases, and stop for approval at the end of each.
