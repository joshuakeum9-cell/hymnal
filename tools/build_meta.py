"""Build data/hymns/NNN/meta.json for every hymn from four sources.

  work/meta/hymn_mapping.json  rupang21/hymnEngKorean: new number, old (통일) number, titles
  work/meta/biblia.json        praisenworship.biblia66.com/15: key, time, theme for all 645
  work/bpp/NNN.html            bibletoppt.com credit pages (AI-assisted, spot-check against the book)
  data/hymns/NNN/source.json   composer and lyricist lines printed in the 깔끔이 MuseScore file

It also computes the three-layer rights status (architecture section 12, posture B).
Existing human-entered fields in meta.json (checked_against_book, notes, overrides) are kept.

Usage: python tools/build_meta.py
"""
from __future__ import annotations

import glob
import html
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HANGUL = re.compile(r"[가-힣]")
PD_DEATH_CUTOFF = 1962   # Korea: authors dead by 1962-12-31 kept life+50 and are public domain
PD_PUBLISHED_BEFORE = 1931  # US: published before 1931 (95-year rule, as of 2026)

# Credits that name an old anonymous/traditional source rather than a person
TRADITIONAL = ["미상", "찬숑가", "전통", "Traditional", "Anonymous", "Gesangbuch", "평성가", "민요",
               "Psalter", "Genevan", "Plainsong", "Spiritual", "Folk", "Melody", "Chant"]

# Korean surname list used to spot Korean authors written in Latin letters
SUR = (r"(Kim|Lee|Yi|Rhee|Park|Pak|Choi|Choe|Jung|Jeong|Chung|Hwang|Na|Ra|Kang|Cho|Jo|Yoon|Yun|Jang|"
       r"Chang|Lim|Im|Han|Oh|Seo|Suh|Shin|Sin|Kwon|Song|Ahn|An|Yoo|Yu|Ryu|Hong|Moon|Mun|Bae|Baek|Paik|"
       r"Nam|Koo|Ku|Noh|Roh|Ha|Jeon|Chun|Jun|Kwak|Sung|Seong|Cha|Joo|Ju|Woo|Min|Ko|Goh|Yang|Byun|Won|"
       r"Pyo|Do|Ma|Suk|Seok|Shim|Sim|Chae|Eom|Um|Jin|Tak|Bang|Gil|Kil|Ok|Ham|Choo|Chu|Kong|Gong|Son|"
       r"Sohn|Yeo|Hyun|Yeom|Gwon|Baik|Jee|Ji|Gu|Wang|Uhm)")

NOTE_NAMES = {"C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7,
              "F": -1, "Bb": -2, "Eb": -3, "Ab": -4, "Db": -5, "Gb": -6, "Cb": -7}


def grab(s: str, label: str):
    m = re.search(r'"children":"' + label + r'"\}\],\["\$","dd",null,\{"className":"[^"]*","children":'
                  r'(\[[^\]]*\]|"[^"]*"|null)', s)
    if not m:
        return None
    v = m.group(1)
    try:
        v = json.loads(v)
    except Exception:
        return v
    if isinstance(v, list):
        v = "".join(str(x) for x in v if x is not None)
    return html.unescape(str(v)).strip() if v else None


def parse_bpp(path: str) -> dict:
    s = open(path, encoding="utf-8", errors="ignore").read()
    if len(s) < 5000:
        return {}
    s = s.replace('\\"', '"').replace("\\u003c", "<").replace("\\u003e", ">")
    r = {}
    for lab, key in [("영문 원제", "original_title"), ("작사", "lyricist"), ("작곡", "composer"),
                     ("작곡 연도", "year"), ("Meter", "meter"), ("조성", "key")]:
        r[key] = grab(s, lab)
    r["ai_draft"] = "ai-draft" in s
    # "(Latin Name, 1858~1924)" in the prose gives life dates
    text = html.unescape(re.sub(r"<[^>]+>", " ", s))
    r["life_dates"] = {m.group(1).strip(): (int(m.group(2)), int(m.group(3)))
                       for m in re.finditer(r"\(([A-Z][A-Za-z .'\-]{3,60}),\s*(1[5-9]\d\d)\s*[~\-–]\s*(1[5-9]\d\d|20\d\d)\)", text)}
    return r


KOREAN_ROMANIZED = re.compile(r"(^|[\s(])" + SUR + r"\s+[A-Z][a-z]+-?[a-z]+\b|\b[A-Z][a-z]+-[a-z]+\s+" + SUR + r"\b")


def korean_name(x: str | None) -> bool:
    """True when a bibletoppt credit names a Korean author, written as 'Kim Doo-wan' or 'Doo-wan Kim'.

    Hangul alone proves nothing there, because Western names are transliterated too
    (네이엄 테이트 = Nahum Tate). The stronger signal is the MuseScore file's own credit line,
    where the transcriber wrote Korean names in Hangul and Western names in Latin letters.
    """
    if not x or any(w.lower() in x.lower() for w in TRADITIONAL):
        return False
    return bool(KOREAN_ROMANIZED.search(x))


def latin_name(x: str | None) -> str:
    if not x:
        return ""
    m = re.search(r"\(([^)]*)\)", x)
    return (m.group(1) if m else x).strip()


def years_in(x: str | None) -> tuple[int, int] | None:
    if not x:
        return None
    m = re.search(r"(1[5-9]\d\d)\s*[~\-–]\s*(1[5-9]\d\d|20\d\d)", x)
    return (int(m.group(1)), int(m.group(2))) if m else None


def death_year(credit: str | None, life_dates: dict) -> int | None:
    y = years_in(credit)
    if y:
        return y[1]
    lat = latin_name(credit)
    if not lat:
        return None
    last = lat.split()[-1] if lat.split() else ""
    for name, (_, d) in life_dates.items():
        if lat and (lat in name or name in lat or (last and last in name.split())):
            return d
    return None


def first_year(x: str | None) -> int | None:
    if not x:
        return None
    m = re.search(r"(1[4-9]\d\d|20\d\d)", x)
    return int(m.group(1)) if m else None


def layer_status(credit: str | None, ccm_credit: str, life: dict, year: int | None,
                 korean: bool) -> dict:
    if korean:
        return {"status": "gated", "basis": "Korean author (copyright managed in Korea)"}
    if credit and any(w.lower() in credit.lower() for w in TRADITIONAL):
        return {"status": "pd_likely", "basis": f"traditional or anonymous source: {credit}"}
    d = death_year(credit, life) or death_year(ccm_credit, life)
    if d is not None:
        if d <= PD_DEATH_CUTOFF and (year is None or year < PD_PUBLISHED_BEFORE):
            return {"status": "pd_verified", "basis": f"author died {d}; work dated {year or 'unknown'}"}
        if d > PD_DEATH_CUTOFF:
            return {"status": "gated", "basis": f"author died {d}, after {PD_DEATH_CUTOFF}"}
    if year is not None:
        if year < PD_PUBLISHED_BEFORE:
            return {"status": "pd_likely", "basis": f"work dated {year}, no evidence of a death after {PD_DEATH_CUTOFF}"}
        return {"status": "gated", "basis": f"work dated {year}, may still be in copyright"}
    return {"status": "unknown", "basis": "no dates found; check the printed credit line"}


def main() -> None:
    mapping = json.load(open(os.path.join(ROOT, "work/meta/hymn_mapping.json"), encoding="utf-8"))
    biblia = {int(r[0]): r for r in json.load(open(os.path.join(ROOT, "work/meta/biblia.json"), encoding="utf-8"))}
    counts: dict[str, int] = {}
    for d in sorted(glob.glob(os.path.join(ROOT, "data/hymns/*"))):
        n = int(os.path.basename(d))
        src = json.load(open(os.path.join(d, "source.json"), encoding="utf-8"))
        bpp = parse_bpp(os.path.join(ROOT, f"work/bpp/{n:03d}.html"))
        mp = mapping[str(n)]
        b = biblia[n]
        meta_path = os.path.join(d, "meta.json")
        old = json.load(open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}

        ccm_comp, ccm_lyr = src.get("composer", ""), src.get("lyricist", "")
        kor_comp = korean_name(bpp.get("composer")) or bool(HANGUL.search(ccm_comp))
        kor_lyr = korean_name(bpp.get("lyricist")) or bool(HANGUL.search(ccm_lyr))
        year = first_year(bpp.get("year"))
        life = bpp.get("life_dates", {})
        tune = layer_status(bpp.get("composer"), ccm_comp, life, year, kor_comp)
        text_en = layer_status(bpp.get("lyricist"), ccm_lyr, life, year, kor_lyr)
        if bpp.get("ai_draft") and tune["status"] != "gated":
            tune = {"status": "gated", "basis": "credits marked ai-draft on the source page; check the book"}
        text_ko = ({"status": "gated", "basis": "original Korean text"} if kor_lyr else
                   {"status": "claimed", "basis": "Korean translation claimed by 한국찬송가공회; written permission requested"})
        publish = (tune["status"] in ("pd_verified", "pd_likely") and
                   text_en["status"] in ("pd_verified", "pd_likely") and text_ko["status"] != "gated")
        overrides = old.get("rights_override")
        if overrides:
            publish = bool(overrides.get("publish"))

        meta = {
            "number": n,
            "old_number": mp.get("old_num"),
            "title_ko": src.get("title_from_file") or mp["title_ko"],
            "title_en": mp.get("title_en") or "",
            "original_title": bpp.get("original_title") or "",
            "theme": b[2],
            "key_table": b[3],
            "time_table": b[4],
            "composer": bpp.get("composer") or ccm_comp,
            "lyricist": bpp.get("lyricist") or ccm_lyr,
            "credit_line_in_file": {"composer": ccm_comp, "lyricist": ccm_lyr},
            "year": year,
            "meter": bpp.get("meter") or "",
            "korean_authored": kor_comp or kor_lyr,
            "rights": {"tune": tune, "text_en": text_en, "text_ko": text_ko},
            "publish": publish,
            "checked_against_book": old.get("checked_against_book", False),
            "notes": old.get("notes", ""),
            "sources": {
                "notes": {"origin": "깔끔이 CCM, ccm4u.tistory.com, CC BY 4.0",
                          "file": src.get("source_file"), "sha256": src.get("source_sha256"),
                          "changes": src.get("changes", [])},
                "credits": "bibletoppt.com (AI-assisted, spot-check)" + (" ai-draft" if bpp.get("ai_draft") else ""),
                "titles": "rupang21/hymnEngKorean hymn_mapping.json",
            },
        }
        if overrides:
            meta["rights_override"] = overrides
        with open(meta_path, "w", encoding="utf-8", newline="") as fh:
            json.dump(meta, fh, ensure_ascii=False, indent=1)
        key = "publish" if publish else f"gated({tune['status']}/{text_en['status']}/{text_ko['status']})"
        counts[key] = counts.get(key, 0) + 1
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"{v:4d}  {k}")


if __name__ == "__main__":
    main()
