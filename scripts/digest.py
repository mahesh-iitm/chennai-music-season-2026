"""Nightly digest: "what was sung where" for one day, in three shapes.

Called by aggregate.py after the vote. Writes
  build/digest/latest.json and build/digest/<YYYY-MM-DD>.json
which publish.py uploads to the Worker (they are not committed to the public repo).

Each digest holds structured data for the website, the six short parameters of
the approved WhatsApp template, and a longer HTML message for Telegram.
"""
import collections, html, json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

IST = timezone(timedelta(hours=5, minutes=30))
SITE_URL = "https://mahesh-iitm.github.io/chennai-music-season-2026/"
NON_SONG = {"tani", "alapana"}


def ist_yesterday():
    return (datetime.now(IST).date() - timedelta(days=1)).isoformat()


def _fmt_day(d):
    x = date.fromisoformat(d)
    return x.strftime("%a %d %b").replace(" 0", " ")


def _clip(s, n):
    s = " ".join(str(s).split())               # WhatsApp params: no newlines or long space runs
    return s if len(s) <= n else s[: n - 1].rstrip(" ,;·") + "…"


def build(day, consensus, concerts, sabha_names):
    """day: 'YYYY-MM-DD' (the day being summarised)."""
    next_day = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
    on_day = {cid: c for cid, c in consensus.items() if concerts.get(cid, {}).get("date") == day and c["songs"]}

    # season-wide counts, to spot krithis heard only on this day
    season = collections.Counter()
    for c in consensus.values():
        for s in c["songs"]:
            if s["type"] not in NON_SONG:
                season[s["song_id"] or s["key"]] += 1

    ragas, n_songs, mains, gems = collections.Counter(), 0, [], []
    sabhas = set()
    for cid, c in sorted(on_day.items(), key=lambda kv: concerts[kv[0]]["time"]):
        meta = concerts[cid]; sabhas.add(meta["sabha_id"])
        main = None
        for s in c["songs"]:
            if s["type"] in NON_SONG:
                continue
            n_songs += 1
            if s["raga"]:
                ragas[s["raga"]] += 1
            if s["type"] == "rtp" or "main" in (s.get("notes") or "").lower():
                main = main or s
            if season[s["song_id"] or s["key"]] == 1:
                gems.append({"title": s["title"], "raga": s["raga"], "composer": s["composer"], "artist": meta["artist"], "concert_id": cid})
        if main:
            mains.append({"artist": meta["artist"], "sabha": sabha_names.get(meta["sabha_id"], meta["sabha_id"]),
                          "raga": main["raga"], "title": "RTP" if main["type"] == "rtp" else main["title"], "concert_id": cid})

    tomorrow = [c for c in concerts.values() if c.get("date") == next_day]
    data = {
        "date": day, "label": _fmt_day(day), "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "concerts_with_lists": len(on_day), "sabhas": len(sabhas), "songs": n_songs,
        "top_ragas": [{"name": r, "count": n} for r, n in ragas.most_common(5)],
        "main_pieces": mains, "rare_gems": gems[:10],
        "next_day": {"date": next_day, "label": _fmt_day(next_day), "concerts": len(tomorrow),
                     "sabhas": len({c["sabha_id"] for c in tomorrow})},
        "url": SITE_URL + "#/daily/" + day,
    }

    # --- WhatsApp template parameters ({{1}}..{{6}}) ---
    wa = [
        data["label"],
        f"{len(on_day)} concert{'s' if len(on_day) != 1 else ''} at {len(sabhas)} sabha{'s' if len(sabhas) != 1 else ''}, {n_songs} songs",
        ", ".join(f"{r['name']} ({r['count']})" for r in data["top_ragas"][:3]) or "none recorded",
        "; ".join(f"{m['artist']}: {m['raga']}" for m in mains[:4]) or "not marked",
        (f"{gems[0]['title']} ({gems[0]['raga']}) by {gems[0]['artist']}" if gems else "none yet"),
        f"{len(tomorrow)} concerts at {data['next_day']['sabhas']} sabhas",
    ]
    data["whatsapp_params"] = [_clip(p, n) for p, n in zip(wa, (20, 80, 120, 240, 160, 60))]

    # --- Telegram (HTML) ---
    e = html.escape
    lines = [f"🎶 <b>Margazhi Song Lists · {e(data['label'])}</b>",
             f"{len(on_day)} concerts at {len(sabhas)} sabhas shared their song lists ({n_songs} songs).", ""]
    if data["top_ragas"]:
        lines.append("<b>Most-heard ragas:</b> " + e(", ".join(f"{r['name']} ({r['count']})" for r in data["top_ragas"])))
    if mains:
        lines.append("<b>Main pieces:</b>")
        lines += [f"• {e(m['artist'])} ({e(m['sabha'])}): {e(m['raga'])}, {e(m['title'])}" for m in mains[:10]]
    if gems:
        lines.append("<b>Rare gems (first time this season):</b>")
        lines += [f"• {e(g['title'])} ({e(g['raga'])}) by {e(g['artist'])}" for g in gems[:5]]
    lines += ["", f"<b>{e(data['next_day']['label'])}:</b> {len(tomorrow)} concerts at {data['next_day']['sabhas']} sabhas.",
              f"Full lists: {data['url']}", "Heard a concert? Share its song list on the site."]
    data["telegram_html"] = "\n".join(lines)
    return data


def write(out_dir, digest):
    d = Path(out_dir) / "digest"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{digest['date']}.json").write_text(json.dumps(digest, ensure_ascii=False, indent=1))
    (d / "latest.json").write_text(json.dumps(digest, ensure_ascii=False, indent=1))
