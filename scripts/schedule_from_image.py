#!/usr/bin/env python3
"""Turn a published sabha schedule (photo, scan or PDF page) into a draft CSV.

  export ANTHROPIC_API_KEY=...
  python scripts/schedule_from_image.py music-academy schedule.jpg [page2.png ...]
  python scripts/schedule_from_image.py music-academy schedule.pdf

Writes data/schedules/<sabha-id>.draft.csv. Check it against the original,
then rename it to <sabha-id>.csv and run scripts/build_concerts.py.
Only uses the Python standard library.
"""
import base64, csv, json, os, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMPT = """This is a Chennai December Season concert schedule for one sabha.
List every concert. Return ONLY JSON: {"concerts":[{"date":"YYYY-MM-DD","time":"HH:MM (24h)","artist":"main artist(s)",
"accompanists":"comma-separated, with instrument in brackets","category":"vocal|violin|veena|flute|nagaswaram|dance|lec-dem|other","venue":"if stated","notes":"e.g. ticketed, free"}]}
The season runs Nov 2026 to Jan 2027: infer the year from the month. Keep artist names as printed."""

MEDIA = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf"}

def block(p):
    mt = MEDIA.get(p.suffix.lower())
    if not mt: sys.exit(f"unsupported file {p}")
    data = base64.b64encode(p.read_bytes()).decode()
    kind = "document" if mt == "application/pdf" else "image"
    return {"type": kind, "source": {"type": "base64", "media_type": mt, "data": data}}

def main():
    if len(sys.argv) < 3: sys.exit(__doc__)
    sabha, files = sys.argv[1], [Path(a) for a in sys.argv[2:]]
    rows = []
    for f in files:
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", method="POST", headers={
            "x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01", "content-type": "application/json"},
            data=json.dumps({"model": os.environ.get("MODEL", "claude-sonnet-5-5"), "max_tokens": 16000,
                             "messages": [{"role": "user", "content": [block(f), {"type": "text", "text": PROMPT}]}]}).encode())
        text = "".join(c.get("text", "") for c in json.load(urllib.request.urlopen(req))["content"])
        text = text[text.find("{"): text.rfind("}") + 1]
        rows += json.loads(text)["concerts"]
        print(f"{f.name}: {len(rows)} concerts so far")
    out = ROOT / "data/schedules" / f"{sabha}.draft.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["date", "time", "artist", "accompanists", "category", "venue", "notes"])
        w.writeheader()
        for r in rows: w.writerow({k: r.get(k, "") for k in w.fieldnames})
    print(f"Draft written to {out}. Check it, then rename to {sabha}.csv")

if __name__ == "__main__":
    main()
