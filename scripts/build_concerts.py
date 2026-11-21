#!/usr/bin/env python3
"""Build site/data/concerts.json from data/schedules/<sabha-id>.csv.

One CSV per sabha, named by the sabha id in site/data/sabhas.json, e.g.
data/schedules/music-academy.csv with columns:
  date (YYYY-MM-DD), time (HH:MM, 24h), artist, accompanists, category, venue, notes
Files whose names start with "_" are ignored. Rasika-added concerts (from the
Worker export) are merged in by aggregate.py, not here.
"""
import csv, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sabhas = {s["id"]: s for s in json.loads((ROOT / "site/data/sabhas.json").read_text())["sabhas"]}

def concert_id(sabha, date, time):
    return f"{sabha}-{date}-{time.replace(':', '')}"

def main():
    concerts, errors = [], []
    for f in sorted((ROOT / "data/schedules").glob("*.csv")):
        if f.name.startswith("_") or ".draft" in f.name:
            continue
        sid = f.stem
        if sid not in sabhas:
            errors.append(f"{f.name}: '{sid}' is not a sabha id in sabhas.json"); continue
        with f.open(newline="", encoding="utf-8-sig") as fh:
            for n, row in enumerate(csv.DictReader(fh), start=2):
                d, t, a = (row.get("date") or "").strip(), (row.get("time") or "").strip(), (row.get("artist") or "").strip()
                if not (d or t or a):
                    continue
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) or not re.fullmatch(r"\d{1,2}:\d{2}", t) or not a:
                    errors.append(f"{f.name} line {n}: need date YYYY-MM-DD, time HH:MM and artist"); continue
                t = t.zfill(5)
                concerts.append({
                    "id": concert_id(sid, d, t), "sabha_id": sid, "date": d, "time": t, "artist": a,
                    "accompanists": (row.get("accompanists") or "").strip(),
                    "category": (row.get("category") or "").strip(),
                    "venue": (row.get("venue") or "").strip() or sabhas[sid].get("area", ""),
                    "notes": (row.get("notes") or "").strip(), "source": "schedule",
                })
    ids = [c["id"] for c in concerts]
    dups = {i for i in ids if ids.count(i) > 1}
    for i in sorted(dups):
        errors.append(f"duplicate slot {i}: two concerts at the same sabha, date and time")
    concerts.sort(key=lambda c: (c["date"], c["time"], c["sabha_id"]))
    out = ROOT / "site/data/concerts.json"
    out.write_text(json.dumps({"season": "2026-27", "concerts": concerts}, ensure_ascii=False, indent=1))
    print(f"{len(concerts)} concerts from {len({c['sabha_id'] for c in concerts})} sabhas -> {out.relative_to(ROOT)}")
    if errors:
        print("\n".join("ERROR " + e for e in errors)); sys.exit(1)

if __name__ == "__main__":
    main()
