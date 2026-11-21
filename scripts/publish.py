#!/usr/bin/env python3
"""Upload tonight's private results (build/) to the Worker, which serves them to the site.

Song lists and statistics live only in Cloudflare D1, not in the public GitHub repo.
  EXPORT_URL=https://<worker>/api/export EXPORT_TOKEN=... python scripts/publish.py
"""
import json, os, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"

def post(url, tok, items):
    req = urllib.request.Request(url, data=json.dumps({"items": items}).encode(), method="POST",
                                 headers={"authorization": f"Bearer {tok}", "content-type": "application/json", "user-agent": "cms2026-publish"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def main():
    exp, tok = os.environ.get("EXPORT_URL"), os.environ.get("EXPORT_TOKEN")
    if not exp or not tok: sys.exit("set EXPORT_URL and EXPORT_TOKEN")
    url = exp.replace("/api/export", "/api/publish")
    cons = json.loads((BUILD / "consensus.json").read_text())
    items = [{"name": "stats", "data": json.loads((BUILD / "stats.json").read_text())},
             {"name": "concert-index", "data": {cid: c["n_rasikas"] for cid, c in cons["concerts"].items()}}]
    items += [{"name": f"concert/{cid}", "data": c} for cid, c in cons["concerts"].items()]
    for f in sorted((BUILD / "digest").glob("*.json")) if (BUILD / "digest").exists() else []:
        items.append({"name": f"digest/{f.stem}", "data": json.loads(f.read_text())})
    n = 0
    for i in range(0, len(items), 50):
        n += post(url, tok, items[i:i + 50]).get("saved", 0)
    print(f"published {n} of {len(items)} items")

if __name__ == "__main__":
    main()
