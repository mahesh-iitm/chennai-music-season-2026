#!/usr/bin/env python3
"""Morning send: post yesterday's digest to WhatsApp subscribers and the Telegram channel.

Reads the latest digest from the Worker (published by the nightly vote) and records what
was sent in data/digest_sent.json, so a re-run never sends the same day twice.
Each channel is skipped quietly when its secrets are not set.

Environment (GitHub Actions secrets):
  EXPORT_URL, EXPORT_TOKEN            to fetch the subscriber list from the Worker
  WHATSAPP_TOKEN, WHATSAPP_PHONE_ID   Meta WhatsApp Cloud API
  WHATSAPP_TEMPLATE                   approved template name (default margazhi_daily)
  WHATSAPP_LANG                       template language code (default en)
  GRAPH_VERSION                       default v23.0
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID  e.g. @margazhisonglists
  DRY_RUN=1                           print instead of sending
Options: --force (send even if already sent / not yesterday's)
"""
import argparse, json, os, sys, time, urllib.error, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IST = timezone(timedelta(hours=5, minutes=30))
LOG = ROOT / "data/digest_sent.json"
DRY = os.environ.get("DRY_RUN") == "1"


def call(url, payload=None, headers=None, method=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data else "GET"),
                                 headers={"content-type": "application/json", "user-agent": "cms2026-digest", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read() or b"{}")
        except Exception: body = {}
        return e.code, body


def send_whatsapp(d):
    tok, pid = os.environ.get("WHATSAPP_TOKEN"), os.environ.get("WHATSAPP_PHONE_ID")
    exp, etok = os.environ.get("EXPORT_URL"), os.environ.get("EXPORT_TOKEN")
    if not (tok and pid and exp and etok):
        return "skipped (WhatsApp secrets not set)"
    st, body = call(exp.replace("/api/export", "/api/subscribers"), headers={"authorization": f"Bearer {etok}"})
    if st != 200:
        return f"could not fetch subscribers ({st})"
    subs = body.get("subscribers", [])
    url = f"https://graph.facebook.com/{os.environ.get('GRAPH_VERSION') or 'v23.0'}/{pid}/messages"
    tmpl = {"name": os.environ.get("WHATSAPP_TEMPLATE") or "margazhi_daily", "language": {"code": os.environ.get("WHATSAPP_LANG") or "en"},
            "components": [{"type": "body", "parameters": [{"type": "text", "text": p} for p in d["whatsapp_params"]]}]}
    ok = fail = 0
    for n in subs:
        if DRY:
            print("WA ->", n, d["whatsapp_params"]); ok += 1; continue
        st, body = call(url, {"messaging_product": "whatsapp", "to": n, "type": "template", "template": tmpl},
                        headers={"authorization": f"Bearer {tok}"})
        if st == 200: ok += 1
        else:
            fail += 1; print("WhatsApp error", n[-4:], st, json.dumps(body.get("error", body))[:300])
        time.sleep(0.08)                         # stay well under Cloud API throughput limits
    return f"{ok} sent, {fail} failed, {len(subs)} subscribers"


def send_telegram(d):
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not (tok and chat):
        return "skipped (Telegram secrets not set)"
    if DRY:
        print("TG ->", chat, "\n" + d["telegram_html"]); return "dry run"
    st, body = call(f"https://api.telegram.org/bot{tok}/sendMessage",
                    {"chat_id": chat, "text": d["telegram_html"][:4000], "parse_mode": "HTML", "disable_web_page_preview": True})
    return "sent" if st == 200 and body.get("ok") else f"failed ({st}: {body.get('description', '')})"


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--force", action="store_true"); a = ap.parse_args()
    exp = os.environ.get("EXPORT_URL")
    if not exp:
        print("EXPORT_URL not set"); return
    st, d = call(exp.replace("/api/export", "/api/data/digest/latest"))
    if st != 200 or not d.get("date"):
        print("no digest yet"); return
    yesterday = (datetime.now(IST).date() - timedelta(days=1)).isoformat()
    log = json.loads(LOG.read_text()) if LOG.exists() else {}
    if not a.force:
        if d["date"] != yesterday:
            print(f"latest digest is for {d['date']}, not {yesterday}; nothing to send"); return
        if d["date"] in log:
            print(f"{d['date']} already sent"); return
    res = {"whatsapp": send_whatsapp(d), "telegram": send_telegram(d), "at": datetime.now(IST).isoformat(timespec="minutes")}
    print(json.dumps(res))
    if not DRY:
        log[d["date"]] = res
        LOG.write_text(json.dumps(log, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
