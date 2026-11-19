"""Build site/prices.json from the price CSV.

Usage:
    python scripts/build_json.py            # REAL data: data/prices.csv
    python scripts/build_json.py --sample   # SAMPLE data: data/prices.sample.csv

The build always runs the validator first and refuses to build if it fails.
It never falls back to sample data: if data/prices.csv has no data rows and
--sample was not given, it exits 1. Output with is_sample=true must make the
site show the banner "ILLUSTRATIVE DEMO DATA - NOT REAL PRICES".
Standard library only.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate import anomaly_warnings, validate  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
REAL_PATH = REPO_ROOT / "data" / "prices.csv"
SAMPLE_PATH = REPO_ROOT / "data" / "prices.sample.csv"
OUT_PATH = REPO_ROOT / "site" / "prices.json"


def build(rows, is_sample, source_file):
    # Group by item, then by region; keep first-seen order of items/regions.
    items = {}
    for r in rows:
        regions = items.setdefault(r["item"], {})
        regions.setdefault(r["region"], []).append({
            "period": r["period"],
            "price_ngn": int(r["price_ngn"]),
            "unit": r["unit"],
            "spec": r["spec"],
            "delivery_basis": r["delivery_basis"],
            "quote_type": r["quote_type"],
            "source_name": r["source_name"],
            "source_url": r["source_url"],
            "collected_on": r["collected_on"],
            "notes": r["notes"],
        })
    for regions in items.values():
        for records in regions.values():
            records.sort(key=lambda rec: rec["period"])  # YYYY-MM sorts correctly as text

    return {
        "schema_version": 2,
        "is_sample": is_sample,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_file": source_file,
        "record_count": len(rows),
        "items": items,
    }


def main(argv):
    args = argv[1:]
    unknown = [a for a in args if a != "--sample"]
    if unknown:
        print(f"ERROR: unknown argument(s): {' '.join(unknown)}. Only --sample is supported.")
        return 2
    is_sample = "--sample" in args
    path = SAMPLE_PATH if is_sample else REAL_PATH

    rows, problems = validate(path, real=not is_sample)
    if problems:
        print(f"ERROR: validation failed for {path}; refusing to build.")
        for p in problems:
            print(f"  - {p}")
        return 1

    if not rows:
        print(
            f"ERROR: {path} has no data rows. Add checked, sourced prices first.\n"
            "The build will NOT fall back to sample data. To build the demo, run:\n"
            "  python scripts/build_json.py --sample"
        )
        return 1

    for w in anomaly_warnings(rows):
        print(f"WARNING: {w}")

    data = build(rows, is_sample, path.relative_to(REPO_ROOT).as_posix())
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    label = "SAMPLE (is_sample=true)" if is_sample else "REAL (is_sample=false)"
    print(f"Built {OUT_PATH.relative_to(REPO_ROOT).as_posix()} from {data['source_file']}: "
          f"{data['record_count']} record(s), {label}")
    if is_sample:
        print("WARNING: this is ILLUSTRATIVE DEMO DATA - NOT REAL PRICES. Do not deploy.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
