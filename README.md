# TektAnalytics

A sourced, dated record of Nigerian construction material prices, growing into
decision tools (a price dashboard and a basket pricer). Every price links to the
public source it came from, so anyone can check it.

> **Rule:** only checked, sourced prices go in `data/prices.csv`. Never add a price
> you have not verified on its source page. Made-up or demo numbers belong only in
> `data/prices.sample.csv`.

## Layout

| Path | What it is |
|---|---|
| `data/prices.csv` | Real, verified prices (the only data that may be published) |
| `data/prices.sample.csv` | Obviously fake demo rows, for layout testing only |
| `data/taxonomy.csv` | The allowed material names and units (keeps series consistent) |
| `scripts/validate.py` | Checks a price CSV and lists problems by row number |
| `scripts/build_json.py` | Validates, then builds `site/prices.json` for the website |
| `site/` | The website: dashboard (`index.html`) plus placeholder pages |
| `docs/SCOPE.md` | What the prototype will and won't do |
| `docs/BUILD_LOG.md` | Plain-language journal of each build phase |
| `CLAUDE.md` | Rules every AI coding session must follow |

Requires Python 3.8+ (standard library only, nothing to install).

## Run the validator

```sh
python scripts/validate.py                          # checks data/prices.csv
python scripts/validate.py data/prices.sample.csv   # checks the sample file
```

It prints `OK` or a list of problems with row numbers (row 1 is the header).
Files named `*.sample.csv` get the general checks only. Every other file also gets
strict checks: placeholder data is rejected (e.g. `example.com`, or the words
"sample", "illustrative" or "dummy" in the item, spec, source name or notes), and
every item and unit must be listed in `data/taxonomy.csv`.

## Build the site data

```sh
python scripts/build_json.py            # real data -> site/prices.json (is_sample: false)
python scripts/build_json.py --sample   # demo data -> site/prices.json (is_sample: true)
```

The builder runs the validator first and refuses to build if it fails. It never
uses sample data unless you pass `--sample`. If `data/prices.csv` has no rows, the
build fails. `site/prices.json` is generated, so it is not committed. Never deploy
a build where `is_sample` is `true`.

## View the dashboard

```sh
python scripts/build_json.py        # (re)build site/prices.json
python -m http.server -d site       # serve the site folder
```

Then open http://localhost:8000. Opening `index.html` directly as a file will not
work, because browsers block loading data that way. The page shows instructions if
that happens. The chart uses Chart.js 4.4.1 from cdnjs, so it needs internet access.
The cards and table work without it.

## Add a price row (schema v2)

1. Get the price from a real source and check it yourself: a public page, a
   supplier's price list, or a quote from a supplier by phone, WhatsApp or visit.
2. Make sure the material is in `data/taxonomy.csv` (columns `item,unit,category,description`).
   If it is new, add it there first. Use the exact same `item` and `unit` text in
   every price row, so prices for the same material line up on the chart.
3. Add one line to `data/prices.csv`, with the columns in this order:
   `item,spec,unit,region,price_ngn,period,delivery_basis,quote_type,source_name,source_url,collected_on,notes`

   | Column | What to put | Example |
   |---|---|---|
   | `item` | Exact name from `taxonomy.csv` | `Cement (50kg bag)` |
   | `spec` | Brand, grade or size. If unknown, say so | `Dangote 42.5R`, `Brand and grade not stated` |
   | `unit` | Exact unit from `taxonomy.csv` | `bag` |
   | `region` | City or area the price applies to | `Lagos` |
   | `price_ngn` | Whole naira, digits only | `10500` (not `10,500` or `₦10,500`) |
   | `period` | Month the price applies to, `YYYY-MM` | `2026-11` |
   | `delivery_basis` | `ex_depot`, `delivered` or `not_stated` | `ex_depot` |
   | `quote_type` | `market_quote` (a supplier told you), `published_report` (an article or report), `supplier_list` (a supplier's published list) | `market_quote` |
   | `source_name` | Who gave or published the price | `ABC Building Materials, Ikeja` |
   | `source_url` | The exact page. May be blank **only** for a `market_quote` | `https://...` |
   | `collected_on` | The day you recorded or checked it, `YYYY-MM-DD` | `2026-11-20` |
   | `notes` | Anything useful. **Required** for a quote with no link: say how it was quoted | `Phone quote, minimum order 50 bags` |

   Wrap any value that contains a comma in double quotes, e.g. `"Abuja, Nasarawa, Niger"`.
4. Run `python scripts/validate.py` and fix anything it reports. A `WARNING` about
   a big price jump does not block anything; it asks you to double-check the
   source, unit and spec.
5. Run `python scripts/build_json.py`, then commit.

**When sources disagree**, add both rows with their own sources. The dashboard
shows the median and says how many sources it used. Never average by hand.

GitHub Actions (`.github/workflows/validate.yml`) runs the same checks on every
push and pull request.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` publishes the site on every push to `main`:
validate → build `site/prices.json` from the real data → refuse if `is_sample`
is not `false` → publish `site/` to GitHub Pages. If any step fails, the live
site stays as it was.

One-time setup on github.com: repo **Settings → Pages → Build and deployment →
Source: GitHub Actions**.

To update the live site after adding prices:

```sh
python scripts/validate.py
git add data/prices.csv data/taxonomy.csv
git commit -m "Add prices for <month>"
git push
```

The Actions tab shows each deploy; the live link appears on the "Deploy site" run.

## Feedback link

Paste the Google Form link into `site/assets/site.js` (`FEEDBACK_URL = "..."`),
commit and push. Feedback links stay hidden until it is set.
