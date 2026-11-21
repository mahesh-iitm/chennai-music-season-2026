#!/usr/bin/env python3
"""Build site/data/songs.json from data/karnatik/karnatik_songs_standardised.xlsx.

Titles are shown in plain readable form (vAtApi gaNapatim -> Vatapi Ganapatim);
the karnatik.com spelling is kept as `orig`. Composer spellings are merged.
"""
import collections, json, re
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent

def plain(s):
    s = (s or "").lower()
    for a, b in (("aa", "a"), ("ee", "i"), ("ii", "i"), ("oo", "u"), ("uu", "u")):
        s = s.replace(a, b)
    return s

def readable(s):
    s = re.sub(r"\s+", " ", plain(s)).strip()
    return re.sub(r"(^|[\s(/-])([a-z])", lambda m: m.group(1) + m.group(2).upper(), s)

def ckey(s):
    s = plain(s).replace("hh", "h")
    s = re.sub(r"([sbdktcgjp])h", r"\1", s).replace("w", "v")
    return re.sub(r"[^a-z]", "", s)

COMPOSER = {   # conventional spellings for the most frequent composers
    "Tyaagaraaja": "Tyagaraja", "Muttuswaamee Dikshitar": "Muthuswami Dikshitar", "Muttuswaami Dikshitar": "Muthuswami Dikshitar",
    "Shyaamaa Shaastree": "Syama Sastri", "Purandara Daasar": "Purandara Dasa", "Paapanaasam Shivan": "Papanasam Sivan",
    "OotukkaaDu VenkaTasubbaiyyar": "Oothukkadu Venkata Kavi", "Swaati TirunaaL": "Swathi Thirunal",
    "H.N. Muttayyah Bhaagavatar": "Harikesanallur Muthiah Bhagavatar", "H.N. Muttiah Bhaagavatar": "Harikesanallur Muthiah Bhagavatar",
    "Suddhaananda Bhaarati": "Shuddhananda Bharati", "Subramanya Bhaaratiyaar": "Subramania Bharathi", "BaalamuraLi Krishna": "M. Balamuralikrishna",
    "KOTeeshwara Aiyyar": "Koteeswara Iyer", "Periyasaami Tooran": "Periyasami Thooran", "Mysore VaasudEvaacaarya": "Mysore Vasudevachar",
    "PaTnam Subramanya Aiyyar": "Patnam Subramania Iyer", "Walajapet Venkatramana Bhaagavatar": "Walajapet Venkataramana Bhagavatar",
    "Badraacala Raamadaas": "Bhadrachala Ramadas", "Annamaacaarya": "Annamacharya", "Aandaal": "Andal", "Veenai Kuppayyar": "Veena Kuppayyar",
    "G.N. Baalasubramaniam": "G. N. Balasubramaniam", "Pooci Sreenivaasa Aiyyangaar": "Poochi Srinivasa Iyengar",
    "TiruveTTiyoor Tyaagayya": "Tiruvottiyur Tyagayya", "Mysore Sadaashiva Rao": "Mysore Sadasiva Rao",
}

def main():
    ws = openpyxl.load_workbook(ROOT / "data/karnatik/karnatik_songs_standardised.xlsx", read_only=True)["Songs"]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    groups = collections.defaultdict(collections.Counter)
    for r in rows:
        if r[5]: groups[ckey(r[5])][r[5]] += 1
    comp = {}
    for k, cnt in groups.items():
        best = cnt.most_common(1)[0][0]
        name = next((COMPOSER[v] for v in cnt if v in COMPOSER), None) or readable(best)
        for v in cnt: comp[v] = name
    out = [[r[0], readable(r[2]), r[3] or "", r[4] or "", comp.get(r[5], "") if r[5] else "", r[6] or "", r[2] or ""] for r in rows]
    # songs found only on shivkumar.org (ids from 100001); see data/shivkumar/
    # songs not in karnatik.com, from other sources (ids from 100001): data/<source>/extra_songs.json
    for extra in sorted((ROOT / "data").glob("*/extra_songs.json")):
        out += [r[:7] for r in json.loads(extra.read_text())["songs"]]
    (ROOT / "site/data/songs.json").write_text(json.dumps(
        {"fields": ["id", "title", "raga", "tala", "composer", "language", "orig"],
         "source": "https://www.karnatik.com/lyrics.shtml (scraped 19 Nov 2026; raga, tala and composer spellings standardised) plus songs found only on shivkumar.org and in Sangita Sampradaya Pradarsini Part V (ids 100001+)",
         "songs": out}, ensure_ascii=False, separators=(",", ":")))
    print(len(out), "songs,", len(set(comp.values())), "composers")

if __name__ == "__main__":
    main()
