# TektAnalytics build log

A plain-language journal of what was built in each phase, and why.
New entries are added at the bottom after every phase.

---

## 2026-11-18 — Phase 0: scaffold, rules and data pipeline

**What was built**

- **Rules file (`CLAUDE.md`).** The project's non-negotiable rules, kept at the top of
  the repo so every future AI session reads them first. The most important rule:
  never invent a price.
- **Scope document (`docs/SCOPE.md`).** What the prototype will and won't do before
  the investor demo. Writing this down stops "scope creep", where extra features
  sneak in and delay the important ones.
- **Real data file (`data/prices.csv`).** It holds two verified cement prices (Abuja
  area, December 2025 and February 2026), both from a Nigeria Housing Market article
  citing Cement Net. Every row has a source link, so anyone can check where the
  number came from.
- **Sample data file (`data/prices.sample.csv`).** Made-up rows with obviously fake
  names ("Demo Material A", "demo.invalid"), used only to test the website layout
  before enough real data exists. It is kept separate so fake numbers can never be
  mixed up with real ones.
- **Validator (`scripts/validate.py`).** A checker that reads a CSV and lists every
  problem by row number: missing fields, negative or non-numeric prices, badly
  formatted months, non-web links, duplicates. For the real file it also rejects
  anything that looks like placeholder data (e.g. `example.com`, or the word
  "sample" in the notes). It works like a spell-checker for the data.
- **Builder (`scripts/build_json.py`).** It turns the CSV into `site/prices.json`,
  the format the website will read. It runs the validator first and refuses to build
  if anything is wrong. It only uses the sample file if you pass `--sample`, and
  then it marks the output `is_sample: true`, so the site can show a warning banner.
- **Automatic checks (`.github/workflows/validate.yml`).** Every time code is pushed
  to GitHub, GitHub runs the validator and builder. If either fails, the push is
  marked as failed, which catches mistakes early.
- **Placeholder pages (`site/*.html`).** Empty "Under construction" pages for the
  dashboard, pricer, methodology and about pages. They contain no numbers or claims
  yet.

**Why it was built this way**

The whole value of TektAnalytics is trust: an investor or builder must be able to
believe every number. So Phase 0 builds the safety rails (validation, sample
separation, CI) *before* any visible features. This makes it hard to publish a wrong
or fake number by accident.

**Tests run**

A temporary CSV with nine deliberate errors was run through the validator, and it
caught all nine. The real and sample files both pass, the builder works on the
real file, and `--sample` correctly marks the output as sample data. A header-only
copy of the real file was also tested: the build failed with a clear message and
did not fall back to sample data. The temporary files were then deleted.

---

## 2026-11-19 — Phase 1: dashboard wired to real data

**What was built**

- **The dashboard (`site/index.html`).** The home page now reads `site/prices.json`
  (made by the builder from `data/prices.csv`) and draws everything from it. The
  page code contains no prices, material names or percentages. If the CSV changes
  and you rebuild, the page changes. This was tested by changing a price in a
  throwaway copy and watching the page update.
- **Sidebar.** Dashboard, Basket Pricer and Methodology, plus a greyed-out "Coming
  next" group (Supplier Benchmarks, TektSupply, TektMaterials) so nobody thinks
  those exist yet. There is no fake user profile, bell or search box.
- **Header line.** "Data last updated" shows the most recent month in the data (not
  today's date), plus counts of records and sources, all calculated from the file.
- **Price cards.** One card per material and region (up to 6, newest first),
  showing the latest price, its month, and how much it changed.
- **Chart.** Price over time for whichever material and region you pick. It uses
  **Chart.js 4.4.1**, loaded from cdnjs and pinned to that exact version with an
  integrity hash, so the browser refuses the file if anyone tampers with it.
- **Table.** The latest price for every material and region, with a clickable link
  to the source page.
- **Demo banner.** If the data was built with `--sample`, a yellow banner reading
  "ILLUSTRATIVE DEMO DATA - NOT REAL PRICES" appears across the top. Real data
  never shows it.

**How the change labels work (and why)**

The change compares the latest month with the **previous month that has a price**,
which is not always the month just before. The label says exactly how far apart
the two months are:

- 1 month apart → "+4.0% month-on-month"
- More than 1 month apart → "+7.1% over 2 months" (e.g. December 2025 → February
  2026). Calling that "month-on-month" would overstate how fast prices move.
- Only one month of data → "n/a - one period so far". With one point there is
  nothing to compare.

The percentage is (new − old) ÷ old × 100, rounded to one decimal. For cement:
(10,500 − 9,800) ÷ 9,800 = 7.14% → "+7.1%".

On the chart, a **dashed** line means "no price was recorded in the months between
these two points". We don't pretend we know January's price. If there is only one
data point, the chart shows the dot and says "More periods needed to show a trend",
rather than drawing a line. If two sources report the same month, the page shows
the middle value (median) and says "median of 2 sources", so the merging is visible.

**Safety and quality**

- Text from the data file is always inserted as plain text, never as HTML. A test
  material named `<img src=x onerror=alert(1)>` showed up as harmless text.
- Source links are only made clickable if they start with `http://` or `https://`.
  A `javascript:` link in a test file showed as plain text. Links open in a new tab
  with `rel="noopener noreferrer"`.
- Works at phone width (390px) with no sideways page scrolling. On a phone the
  table scrolls inside its own box.
- Keyboard users see an orange focus outline. Orange text uses a darker shade so it
  is readable on white.
- If the chart library can't download, the cards and table still work and a
  message explains the missing chart. If `prices.json` is missing, the page explains
  how to build it and run the local server.

---

## 2026-11-19 — Phase 1b: schema v2 and material taxonomy

**What changed and why**

A price only means something if you know exactly *what* was priced and *how*.
₦10,500 for a bag of cement collected from the depot is not the same as ₦10,500
delivered to site, and a supplier's phone quote is not the same as a figure in a
news article. Schema v2 records these differences so prices are compared
like-for-like.

- **Four new columns in `data/prices.csv`:**
  - `spec`: brand, grade or size (e.g. "Dangote 42.5R"). If the source doesn't say,
    write that honestly ("Brand and grade not stated").
  - `delivery_basis`: `ex_depot`, `delivered` or `not_stated`.
  - `quote_type`: `market_quote` (a supplier told you), `published_report` (an
    article or report) or `supplier_list` (a supplier's published price list).
  - `collected_on`: the day you recorded or checked the price, as YYYY-MM-DD.
- **Phone and WhatsApp quotes are now allowed** (owner's decision). Many Nigerian
  suppliers never publish prices online. A `market_quote` may have no web link, but
  it must name the supplier and the notes must say how it was quoted (e.g. "Phone
  quote"). The dashboard shows these as "Supplier name (no public link)" so nobody
  thinks a link is missing by mistake. Every other type still needs an http(s) link.
  `CLAUDE.md` and `docs/SCOPE.md` were updated to match.
- **Material list (`data/taxonomy.csv`).** A list of the allowed material names and
  units. Every row in the real file must use a name and unit from this list. This
  stops one material splitting into two lines on the chart because it was typed
  differently ("Cement 50kg" vs "Cement (50kg bag)"). It only has cement for now.
  Add a material there before adding its first price.
- **Price-jump warning.** If a material's price in a region moves more than 20%
  between two periods, the validator prints a WARNING. It never blocks the data,
  because Nigerian prices really do jump. It just prompts a second look at the
  source, unit and spec.
- **Migration.** The two cement rows were moved to the new format: spec "Brand and
  grade not stated", delivery basis `not_stated`, type `published_report`,
  collected on 2026-11-18 (the owner chose this date). The prices did not change.
- **Dashboard.** Under each source in the table there is now a small line with the
  spec, delivery basis, quote type and date recorded. The Source column was widened
  so this stays readable.
- **README.** The "Add a price row" section now has a table explaining every column
  with an example.

**New validator checks**

`spec` filled in; `delivery_basis` and `quote_type` from the allowed lists;
`collected_on` a real calendar date, not in the future and not before the month the
price applies to; a blank link only for a `market_quote` with notes; item and unit
in the taxonomy (real file only); duplicates now judged on item, spec, region,
period, delivery basis and source. An old-format file is rejected with the exact
new header to use.

**Tests run**

A throwaway file with 12 deliberate mistakes (empty spec, unknown delivery basis and
quote type, missing link on a published report, 30 February, a date before the
price month, a future date, an item not in the taxonomy, an `ftp://` link, a
duplicate, a placeholder URL and the word "sample") was run through the validator:
it caught all 12. An old v1 file was rejected with a clear message. A 31% jump gave
a warning and still passed. The real and sample files both pass, both builds work,
and the dashboard was checked in the browser with both: the demo phone quote shows
"(no public link)", and the real cement card still shows ₦10,500 and "+7.1% over 2
months". The throwaway files were kept outside the repo.

**Limit to know about:** the chart still groups prices by material and region. If
one month has two different brands for the same material, the chart shows their
median and says "median of 2 sources". A per-brand view can come later.

---

## 2026-11-19 — Phase 2: basket pricer

**What was built**

- **`site/pricer.html` + `site/assets/pricer.js`.** Pick a region, add materials,
  type quantities, and get a line total and grand total from the latest sourced
  price of each material. Every line shows the price month and its source (link,
  or "no public link" for a phone/WhatsApp quote) with spec, delivery basis and
  quote type.
- **Escalation estimate (estimate, not a forecast).** Enter "months until
  purchase". For materials with 3+ months of prices it averages the
  monthly-equivalent change over up to the last 6 months (`g`) and adds
  `(1 + g)^m − 1` as an allowance. Fewer than 3 months: it says "Not shown" and
  why, and the total note says which lines have no estimate. The formula is
  written out on the page.
- **Print** (clean page, no sidebar or buttons, region and date at the top) and
  **Download CSV** (opens in Excel; the demo label is included if demo data is
  loaded; cells that look like spreadsheet formulas are neutralised).
- Runs fully in the browser. Nothing is saved or sent anywhere.

**Tests run**

- Test data with 3 months (₦1,000 → ₦1,100 → ₦1,210, a 2-month gap at the end),
  10 bags, 6 months: page showed g = +7.44%/month, +53.8%, allowance ₦6,512, total
  ₦19,812. Recomputed separately in Python: same numbers.
- Two sources in one month showed their median and "median of 2 sources".
- A material named `<img src=x onerror=alert(1)>` showed as text; a
  `javascript:` link was not clickable.
- Real data: 100 bags of cement = ₦1,050,000; escalation correctly hidden (2 months).
- Phone width (375px): no sideways page scroll; the basket table scrolls in its box.

**Known limits:** on a phone the basket table needs a sideways swipe. The
pricer only becomes useful as more materials are added to `prices.csv`.

---

## 2026-11-19 — Phase 3: trust pages and feedback link

**What was built**

- **Methodology page.** Plain-English explanation of what each row records, where
  prices come from (including phone/WhatsApp quotes marked "no public link"), how
  data is checked (human check + validator + 20% jump warning + version history),
  every calculation (latest price, median, honest change labels, chart gaps, line
  totals, escalation formula), why there is no basket index yet, and the limits.
  A **"Data coverage right now"** box counts materials, regions, records, sources
  and months live from `prices.json`, so it can never go out of date.
- **About page.** The problem, what is live vs not built yet, who is building it
  (Tektavon, Peculiar Akintoye, Department of Building, UNILAG), and a request for
  feedback. No claims about users, traction or partners.
- **Feedback link, one setting.** `site/assets/site.js` has `FEEDBACK_URL = ""`.
  Paste the Google Form link there and a "Give feedback" link appears in every
  sidebar plus buttons on About and Methodology. While it's empty, nothing is shown
  (so there is never a broken link). Only Google Forms links are accepted.
- **Menu.** About added to the sidebar on all pages.

**Tests run:** with a test form link, the sidebar link and buttons appeared on
every page; with it empty, they were hidden and About shows "link will be added
shortly". Coverage box showed 1 material, 1 region, 2 records, 1 source,
December 2025 to February 2026 for the real data.

**To do (owner):** paste the Google Form link into `site/assets/site.js`. A
pilot-request email link was left out: suggest adding a "Would you like to pilot
it?" question to the form instead.

---

## 2026-11-19 — Phase 4: deployment

**What was done**

- **Deploy workflow (`.github/workflows/deploy.yml`).** On every push to `main`,
  GitHub validates `data/prices.csv`, builds `site/prices.json` from the real data,
  refuses to continue if the result is sample data, then publishes the `site/`
  folder to GitHub Pages. If any check fails, nothing is published and the live
  site stays as it was.
- **Clean history.** Before the first push, the old local history (which once
  contained fabricated price rows) was backed up to
  `tektanalytics-history-backup.bundle` in the owner's user folder, then replaced
  by one fresh commit on a branch named `main`. The fabricated rows never reached
  GitHub.
- **GitHub repo:** https://github.com/specialztech00-alt/TektAnalytics (public, so
  GitHub Pages is free and anyone can check the data and method). GitHub's starter
  commit (MIT licence + one-line README) was merged in, keeping the full project
  README.
- **README** now explains how to deploy, update prices and set the feedback link.

**How to update the live site:** add rows, run `python scripts/validate.py`, then
commit and `git push`. The site updates about a minute later.

**What happened on the first push:** the repo was private and Pages was not
switched on, so the first deploy stopped at the "configure Pages" step (all data
checks had passed). After the owner made the repo public and set Pages to
"GitHub Actions", the next push deployed.
