"""Validate a TektAnalytics price CSV (schema v2).

Usage:
    python scripts/validate.py                 # checks data/prices.csv
    python scripts/validate.py path/to/file.csv

Any file whose name ends in ".sample.csv" is treated as SAMPLE data and gets the
general checks only. Every other file is treated as REAL data and also gets the
strict checks: no placeholder URLs or words, and every (item, unit) pair must be
listed in data/taxonomy.csv.

Problems (format errors) are printed with their row number (row 1 is the header)
and make the script exit 1. Warnings (e.g. a big price jump) are printed but do
not fail: Nigerian prices genuinely jump, so a warning only means "look again".
The validator checks FORMAT, not TRUTH. The owner is the truth check.
Standard library only.
"""

import csv
import re
import statistics
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = REPO_ROOT / "data" / "prices.csv"
TAXONOMY_PATH = REPO_ROOT / "data" / "taxonomy.csv"

# Schema v2 column order (the order the owner should use when adding rows).
REQUIRED_COLUMNS = [
    "item", "spec", "unit", "region", "price_ngn", "period",
    "delivery_basis", "quote_type", "source_name", "source_url",
    "collected_on", "notes",
]
NON_EMPTY_FIELDS = ["item", "spec", "unit", "region", "source_name"]

DELIVERY_BASIS = ["ex_depot", "delivered", "not_stated"]
QUOTE_TYPES = ["market_quote", "published_report", "supplier_list"]

# YYYY-MM with a real month (01-12).
PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
# YYYY-MM-DD (checked as a real calendar date below).
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Positive whole number: digits only, no sign, no decimals, no commas.
PRICE_RE = re.compile(r"^\d+$")

# Real-file-only bans.
BANNED_URL_PARTS = ["example.com", "example.org", "example.net", "demo.invalid", "localhost"]
BANNED_WORDS = ["sample", "illustrative", "dummy"]

# A move bigger than this between two periods gives a WARNING, never a failure.
ANOMALY_THRESHOLD_PCT = 20.0


def is_sample_path(path):
    return Path(path).name.lower().endswith(".sample.csv")


def load_taxonomy(path=TAXONOMY_PATH):
    """Return (set of (item, unit) pairs, problems)."""
    path = Path(path)
    if not path.is_file():
        return set(), [f"Taxonomy file not found: {path}"]
    pairs, problems = set(), []
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
        for col in ("item", "unit", "category"):
            if col not in header:
                return set(), [f"{path.name} row 1 (header): missing column '{col}'"]
        for row in reader:
            n = reader.line_num
            item = (row.get("item") or "").strip()
            unit = (row.get("unit") or "").strip()
            if not item and not unit:
                continue
            if not item or not unit:
                problems.append(f"{path.name} row {n}: 'item' and 'unit' must both be filled in")
                continue
            if (item, unit) in pairs:
                problems.append(f"{path.name} row {n}: duplicate taxonomy entry ({item}, {unit})")
            pairs.add((item, unit))
    return pairs, problems


def _parse_date(text):
    if not DATE_RE.match(text):
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def validate(path, real=None, today=None):
    """Return (rows, problems). rows is the list of data rows as dicts.

    real=None means: decide from the filename (strict unless *.sample.csv).
    today can be passed in for testing; it defaults to the current date.
    """
    path = Path(path)
    if real is None:
        real = not is_sample_path(path)
    today = today or date.today()

    problems = []
    if not path.is_file():
        return [], [f"File not found: {path}"]

    taxonomy = set()
    if real:
        taxonomy, tax_problems = load_taxonomy()
        if tax_problems:
            return [], tax_problems

    # utf-8-sig tolerates the byte-order mark Excel adds when saving CSVs.
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
        missing = [c for c in REQUIRED_COLUMNS if c not in header]
        if missing:
            return [], [
                f"Row 1 (header): missing required column(s): {', '.join(missing)}. "
                f"Schema v2 header is: {','.join(REQUIRED_COLUMNS)}"
            ]

        rows = []
        seen = {}
        for row in reader:
            # reader.line_num is the physical line just read; header is line 1.
            n = reader.line_num
            # Skip fully blank lines.
            if all((v or "").strip() == "" for v in row.values() if isinstance(v, str)):
                continue
            if None in row:
                problems.append(f"Row {n}: has more fields than the header (check for an unquoted comma)")
            v = {c: (row.get(c) or "").strip() for c in REQUIRED_COLUMNS}
            rows.append(v)

            for field in NON_EMPTY_FIELDS:
                if not v[field]:
                    problems.append(f"Row {n}: '{field}' is empty")

            price = v["price_ngn"]
            if not PRICE_RE.match(price) or int(price) <= 0:
                problems.append(f"Row {n}: price_ngn must be a positive whole number (got '{price}')")

            period_ok = bool(PERIOD_RE.match(v["period"]))
            if not period_ok:
                problems.append(f"Row {n}: period must be YYYY-MM with month 01-12 (got '{v['period']}')")

            if v["delivery_basis"] not in DELIVERY_BASIS:
                problems.append(
                    f"Row {n}: delivery_basis must be one of {', '.join(DELIVERY_BASIS)} "
                    f"(got '{v['delivery_basis']}')"
                )

            if v["quote_type"] not in QUOTE_TYPES:
                problems.append(
                    f"Row {n}: quote_type must be one of {', '.join(QUOTE_TYPES)} (got '{v['quote_type']}')"
                )

            # Source link: required, except a market_quote (phone, WhatsApp or visit)
            # may have no public link, as long as the notes say how it was quoted.
            url = v["source_url"]
            if url:
                if not (url.lower().startswith("http://") or url.lower().startswith("https://")):
                    problems.append(f"Row {n}: source_url must start with http:// or https:// (got '{url}')")
            elif v["quote_type"] == "market_quote":
                if not v["notes"]:
                    problems.append(
                        f"Row {n}: a market_quote with no source_url must say in 'notes' how it was "
                        "quoted (e.g. 'Phone quote' or 'WhatsApp quote')"
                    )
            else:
                problems.append(
                    f"Row {n}: source_url is empty. Only a market_quote (phone/WhatsApp/visit) may "
                    "have no link"
                )

            collected = _parse_date(v["collected_on"])
            if collected is None:
                problems.append(
                    f"Row {n}: collected_on must be a real date as YYYY-MM-DD (got '{v['collected_on']}')"
                )
            else:
                if collected > today:
                    problems.append(f"Row {n}: collected_on {collected} is in the future")
                if period_ok:
                    period_start = date(int(v["period"][:4]), int(v["period"][5:]), 1)
                    if collected < period_start:
                        problems.append(
                            f"Row {n}: collected_on {collected} is before the price period {v['period']} "
                            "(a price cannot be recorded before the month it applies to)"
                        )

            key = (v["item"], v["spec"], v["region"], v["period"], v["delivery_basis"],
                   v["source_name"], v["source_url"])
            if key in seen:
                problems.append(
                    f"Row {n}: duplicate of row {seen[key]} (same item, spec, region, period, "
                    "delivery basis and source)"
                )
            else:
                seen[key] = n

            if real:
                if v["item"] and v["unit"] and (v["item"], v["unit"]) not in taxonomy:
                    problems.append(
                        f"Row {n}: ({v['item']}, {v['unit']}) is not in data/taxonomy.csv. Use the exact "
                        "item name and unit from the taxonomy, or add a new entry there first"
                    )
                low_url = url.lower()
                for bad in BANNED_URL_PARTS:
                    if bad in low_url:
                        problems.append(f"Row {n}: source_url contains placeholder '{bad}' (not allowed in real data)")
                for field in ("item", "spec", "source_name", "notes"):
                    low = v[field].lower()
                    for word in BANNED_WORDS:
                        if word in low:
                            problems.append(f"Row {n}: {field} contains '{word}' (not allowed in real data)")

    return rows, problems


def _months_between(a, b):
    """Whole months from period a to period b (both YYYY-MM)."""
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:]) - int(a[5:])


def anomaly_warnings(rows, threshold_pct=ANOMALY_THRESHOLD_PCT):
    """Warn when the median price for an item and region moves more than
    threshold_pct between two consecutive periods that have data.
    Assumes rows already passed validate()."""
    series = {}
    for r in rows:
        series.setdefault((r["item"], r["region"]), {}).setdefault(r["period"], []).append(int(r["price_ngn"]))
    warnings = []
    for (item, region), by_period in sorted(series.items()):
        periods = sorted(by_period)
        for prev, cur in zip(periods, periods[1:]):
            old = statistics.median(by_period[prev])
            new = statistics.median(by_period[cur])
            pct = (new - old) / old * 100
            if abs(pct) > threshold_pct:
                gap = _months_between(prev, cur)
                warnings.append(
                    f"{item} in {region}: {pct:+.1f}% from {prev} to {cur} ({gap} month(s)). "
                    f"Over {threshold_pct:.0f}%: please double-check the source, unit and spec."
                )
    return warnings


def main(argv):
    path = Path(argv[1]) if len(argv) > 1 else DEFAULT_PATH
    mode = "sample" if is_sample_path(path) else "real"
    rows, problems = validate(path)
    if problems:
        print(f"FAILED: {path} ({mode} mode) - {len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        return 1
    for w in anomaly_warnings(rows):
        print(f"WARNING: {w}")
    print(f"OK: {path} ({mode} mode) - {len(rows)} data row(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
