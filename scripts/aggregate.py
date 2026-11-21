#!/usr/bin/env python3
"""Nightly aggregation: majority vote per concert + season-level statistics.

  EXPORT_URL=https://<worker>/api/export EXPORT_TOKEN=... python scripts/aggregate.py
  python scripts/aggregate.py --input export.json        # offline / testing

Writes
  site/data/added_concerts.json  concerts rasikas added (public, committed)
  build/consensus.json, build/stats.json, build/digest/   private: uploaded to the Worker by publish.py
  build/open-data/               full anonymised dataset, kept for a possible release after the season
Song lists and statistics are never committed to the public repo.
"""
import argparse, collections, sys, csv, hashlib, json, math, os, re, statistics, urllib.request
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site/data"
BUILD = ROOT / "build"          # private outputs: published to the Worker, never committed
OPEN = BUILD / "open-data"
SUPPORT = 0.5          # a song is "agreed" when at least half the rasikas at that concert listed it

# ---------- transliteration-tolerant keys (same rules as site/app.js) ----------
def plain(s):
    s = (s or "").lower()
    for a, b in (("aa", "a"), ("ee", "i"), ("ii", "i"), ("oo", "u"), ("uu", "u")):
        s = s.replace(a, b)
    return s

def key(s):
    s = re.sub(r"\(.*?\)", "", plain(s)).replace("hh", "h").replace("ow", "au")
    s = re.sub(r"([sbdktcgjp])h", r"\1", s).replace("w", "v").replace("z", "l")
    s = re.sub(r"[^a-z]", "", s)
    return re.sub(r"a$", "", re.sub(r"m$", "", s))

def title_key(s):
    return re.sub(r"(.)\1+", r"\1", key(s))

RAGA_ABBR = {"kal": "Kalyani", "sank": "Shankarabharanam", "shank": "Shankarabharanam", "sankarabaranam": "Shankarabharanam",
             "tod": "Todi", "kamboji": "Kambhoji", "kambodi": "Kambhoji", "kharahar": "Kharaharapriya",
             "kp": "Kharaharapriya", "abhogi": "Abhogi", "pantuvarali": "Kamavardhani",
             "kamavardini": "Kamavardhani", "mayamalavagaula": "Mayamalavagaula", "mmg": "Mayamalavagaula",
             "suddadanyasi": "Shuddhadhanyasi", "rm": "Ragamalika", "ragamalik": "Ragamalika"}

class RagaIndex:
    def __init__(self, ragas):
        self.by_key = {}
        for r in ragas:
            if r:
                self.by_key.setdefault(key(r), r)
        self.keys = list(self.by_key)
    def std(self, raw):
        if not raw or not raw.strip():
            return ""
        k = key(raw)
        if k in self.by_key: return self.by_key[k]
        if k in RAGA_ABBR: return RAGA_ABBR[k]
        best, score = None, 0.0
        for c in self.keys:
            if abs(len(c) - len(k)) > 4: continue
            r = SequenceMatcher(None, k, c).ratio()
            if r > score: best, score = c, r
        return self.by_key[best] if best and score >= 0.84 else raw.strip().title()

NON_SONG = {"tani", "alapana"}   # counted in their own tallies, not as krithis

def anon(s):
    return hashlib.sha256(("cms2026|" + s).encode()).hexdigest()[:10]

def load_export(args):
    if args.input:
        return json.loads(Path(args.input).read_text())
    url, tok = os.environ.get("EXPORT_URL"), os.environ.get("EXPORT_TOKEN")
    if not url or not tok:
        raise SystemExit("set EXPORT_URL and EXPORT_TOKEN, or pass --input")
    req = urllib.request.Request(url, headers={"authorization": f"Bearer {tok}", "user-agent": "cms2026-aggregate"})
    return json.load(urllib.request.urlopen(req, timeout=60))

# ---------- majority vote ----------
def item_key(it, ragas):
    t = (it.get("type") or "kriti").lower()
    if it.get("song_id"):
        return f"song:{it['song_id']}"
    if t == "tani":
        return "tani"
    if t == "rtp":
        return "rtp:" + key(ragas.std(it.get("raga")))
    tk = title_key(it.get("title") or it.get("written") or "")
    return f"title:{tk}:{key(ragas.std(it.get('raga')))}" if tk else None

def consensus_for(subs, songs, ragas):
    n = len(subs)
    votes = collections.defaultdict(list)          # key -> [(rasika, normalised position, item)]
    for s in subs:
        items, seen = s["items"], set()
        L = max(1, len(items))
        for i, it in enumerate(items):
            k = item_key(it, ragas)
            if not k or k in seen: continue
            seen.add(k)
            votes[k].append((s["rasika"], i / L, it))
    agreed, minority = [], []
    for k, vs in votes.items():
        support = len(vs) / n
        def mode(field):
            c = collections.Counter((v[2].get(field) or "").strip() for v in vs if (v[2].get(field) or "").strip())
            return c.most_common(1)[0][0] if c else ""
        sid = vs[0][2].get("song_id")
        song = songs.get(sid) if sid else None
        row = {
            "key": k, "song_id": sid,
            "title": song["title"] if song else mode("title") or mode("written"),
            "raga": song["raga"] if song and song["raga"] else ragas.std(mode("raga")),
            "tala": song["tala"] if song and song["tala"] else mode("tala"),
            "composer": song["composer"] if song and song["composer"] else mode("composer"),
            "type": mode("type") or "kriti",
            "notes": "; ".join(sorted({(v[2].get("notes") or "").strip() for v in vs} - {""}))[:200],
            "votes": len(vs), "support": round(support, 2),
            "_pos": statistics.median(v[1] for v in vs),
        }
        (agreed if support >= SUPPORT else minority).append(row)
    for lst in (agreed, minority):
        lst.sort(key=lambda r: r["_pos"])
        for i, r in enumerate(lst, 1):
            r["pos"] = i; del r["_pos"]
    level = "single report" if n == 1 else "two reports" if n == 2 else "consensus"
    return {"n_rasikas": n, "level": level, "songs": agreed, "disputed": minority}

# ---------- season stats ----------
def season_stats(consensus, concerts, songs, ragas_in_db):
    rend = []                                       # one row per agreed rendition
    for cid, c in consensus.items():
        meta = concerts.get(cid, {})
        for s in c["songs"]:
            rend.append({**s, "concert_id": cid, "artist": meta.get("artist", ""), "sabha_id": meta.get("sabha_id", ""), "date": meta.get("date", "")})
    krithis = [r for r in rend if r["type"] not in NON_SONG]

    def tally(rows, field, top=40):
        c, conc = collections.Counter(), collections.defaultdict(set)
        for r in rows:
            v = (r.get(field) or "").strip()
            if not v: continue
            c[v] += 1; conc[v].add(r["concert_id"])
        return [{"name": k, "renditions": v, "concerts": len(conc[k])} for k, v in c.most_common(top)]

    song_count = collections.Counter()
    song_rows = collections.defaultdict(list)
    for r in krithis:
        k = r["song_id"] or r["key"]
        song_count[k] += 1; song_rows[k].append(r)
    def song_entry(k):
        r0 = song_rows[k][0]
        return {"song_id": r0["song_id"], "title": r0["title"], "raga": r0["raga"], "tala": r0["tala"], "composer": r0["composer"],
                "renditions": song_count[k], "by": sorted({r["artist"] for r in song_rows[k] if r["artist"]})}
    top_songs = [song_entry(k) for k, _ in song_count.most_common(50)]
    sung_once = sorted((song_entry(k) | {"concert_id": song_rows[k][0]["concert_id"], "date": song_rows[k][0]["date"],
                                         "sabha_id": song_rows[k][0]["sabha_id"]}
                        for k, v in song_count.items() if v == 1), key=lambda e: (e["raga"], e["title"]))

    heard = {r["raga"] for r in rend if r["raga"]}
    unheard = [{"name": r, "songs_in_karnatik": n} for r, n in ragas_in_db.most_common() if n >= 5 and r not in heard and r != "Ragamalika"]

    main_pieces = [r for r in rend if r["type"] == "rtp" or "main" in (r.get("notes") or "").lower()]
    by_day = collections.Counter(concerts.get(cid, {}).get("date", "") for cid in consensus)
    artists = collections.defaultdict(lambda: {"concerts": 0, "songs": set(), "ragas": set()})
    for cid, c in consensus.items():
        a = concerts.get(cid, {}).get("artist")
        if not a: continue
        artists[a]["concerts"] += 1
        for s in c["songs"]:
            artists[a]["songs"].add(s["song_id"] or s["key"]); artists[a]["ragas"].add(s["raga"])
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "totals": {
            "concerts_scheduled": len(concerts),
            "concerts_with_lists": len(consensus),
            "concerts_with_consensus": sum(1 for c in consensus.values() if c["n_rasikas"] >= 3),
            "submissions": sum(c["n_rasikas"] for c in consensus.values()),
            "renditions": len(krithis),
            "distinct_songs": len(song_count),
            "distinct_ragas": len(heard),
        },
        "top_ragas": tally(rend, "raga"),
        "top_songs": top_songs,
        "top_composers": tally(krithis, "composer", 25),
        "talas": tally(krithis, "tala", 25),
        "main_piece_ragas": tally(main_pieces, "raga", 25),
        "sung_once": sung_once,
        "ragas_not_heard": unheard[:80],
        "lists_by_day": dict(sorted((d, n) for d, n in by_day.items() if d)),
        "artists": sorted(({"artist": a, "concerts": v["concerts"], "distinct_songs": len(v["songs"]), "distinct_ragas": len(v["ragas"] - {""})}
                           for a, v in artists.items()), key=lambda x: -x["concerts"]),
    }

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--input")
    ap.add_argument("--digest-date", help="YYYY-MM-DD to summarise (default: yesterday, IST)")
    args = ap.parse_args()
    exp = load_export(args)
    sj = json.loads((SITE / "songs.json").read_text())
    songs = {r[0]: dict(zip(sj["fields"], r)) for r in sj["songs"]}
    ragas_in_db = collections.Counter(s["raga"] for s in songs.values() if s["raga"])
    ragas = RagaIndex(ragas_in_db)

    concerts = {c["id"]: c for c in json.loads((SITE / "concerts.json").read_text())["concerts"]}
    added = []
    for c in exp.get("added_concerts", []):
        if c["id"] not in concerts:
            c = {k: c.get(k, "") for k in ("id", "sabha_id", "date", "time", "artist", "accompanists")} | {"source": "rasika"}
            added.append(c); concerts[c["id"]] = c

    by_concert = collections.defaultdict(list)
    for s in exp.get("submissions", []):
        s = {**s, "rasika": anon(s["rasika"])}
        by_concert[s["concert_id"]].append(s)
    consensus = {cid: consensus_for(subs, songs, ragas) for cid, subs in sorted(by_concert.items())}
    stats = season_stats(consensus, concerts, songs, ragas_in_db)

    SITE.mkdir(parents=True, exist_ok=True); OPEN.mkdir(parents=True, exist_ok=True)
    dump = lambda p, o: p.write_text(json.dumps(o, ensure_ascii=False, indent=1))
    dump(BUILD / "consensus.json", {"generated_at": stats["generated_at"], "support_threshold": SUPPORT, "concerts": consensus})
    dump(BUILD / "stats.json", stats)
    dump(SITE / "added_concerts.json", {"concerts": sorted(added, key=lambda c: (c["date"], c["time"]))})
    dump(OPEN / "submissions.json", {"licence": "not yet released", "generated_at": stats["generated_at"],
         "submissions": [{"concert_id": s["concert_id"], "rasika": s["rasika"], "created_at": s["created_at"], "used_photo": s.get("used_photo", False),
                          "items": [{k: it.get(k) for k in ("pos", "song_id", "title", "raga", "tala", "composer", "type", "notes")} for it in s["items"]]}
                         for subs in by_concert.values() for s in subs]})
    with (OPEN / "consensus.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["concert_id", "date", "time", "sabha_id", "artist", "n_rasikas", "pos", "song_id", "title", "raga", "tala", "composer", "type", "notes", "votes", "support"])
        for cid, c in consensus.items():
            m = concerts.get(cid, {})
            for s in c["songs"]:
                w.writerow([cid, m.get("date", ""), m.get("time", ""), m.get("sabha_id", ""), m.get("artist", ""), c["n_rasikas"], s["pos"], s["song_id"] or "",
                            s["title"], s["raga"], s["tala"], s["composer"], s["type"], s["notes"], s["votes"], s["support"]])
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import digest as dg
    sabha_names = {x["id"]: x["name"] for x in json.loads((SITE / "sabhas.json").read_text())["sabhas"]}
    day = args.digest_date or dg.ist_yesterday()
    d = dg.build(day, consensus, concerts, sabha_names)
    if d["concerts_with_lists"]:
        dg.write(BUILD, d); print(f"digest for {day}: {d['concerts_with_lists']} concerts, {d['songs']} songs")
    else:
        print(f"no lists for {day}; digest not written")
    t = stats["totals"]
    print(f"{t['submissions']} submissions, {t['concerts_with_lists']} concerts, {t['renditions']} renditions, {t['distinct_songs']} songs, {t['distinct_ragas']} ragas")

if __name__ == "__main__":
    main()
