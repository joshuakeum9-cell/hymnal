"""Data checks run by CI on every push. Exit code 1 on any failure; messages are written for humans.

  1. every hymn folder has a readable score.musicxml and meta.json
  2. score structure: one part, 2 or 3 staves, key and time in measure 1, no <transpose>,
     every lyric <text> carries xml:lang, every measure's voices add up to the measure length
     and none runs past the time signature
  3. edition lock: data/acceptance.csv rows match meta.json (number, old number, Korean title)
  4. rights gate: a published hymn has public-domain tune and English text layers and a
     Korean text that is not an original Korean work
  5. English files: each verse has exactly one token per melody note, so the build can merge it
  6. site copy: no em dashes or middle dots in the app's own text (house style)

Usage: python tools/check_data.py
"""
from __future__ import annotations

import csv
import glob
import json
import os
import re
import sys

from lxml import etree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hymnlib import XML_LANG, melody_slots  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
problems: list[str] = []


def fail(n, msg):
    problems.append(f"hymn {n}: {msg}" if n else msg)


def check_score(n: int, root) -> None:
    parts = root.findall("part")
    if len(parts) != 1:
        fail(n, f"expected one part, found {len(parts)}")
        return
    staves = root.findtext(".//attributes/staves")
    if staves not in ("2", "3"):
        fail(n, f"expected 2 or 3 staves, found {staves}")
    first = parts[0].find("measure")
    if first is None or first.find("attributes/key") is None or first.find("attributes/time") is None:
        fail(n, "measure 1 needs a key and a time signature")
    if root.find(".//transpose") is not None:
        fail(n, "contains <transpose>; transposition must happen in the browser only")
    for t in root.iter("text"):
        if t.getparent().tag == "lyric" and not t.get(XML_LANG):
            fail(n, "a lyric has no xml:lang")
            break
    divisions = int(root.findtext(".//divisions") or 1)
    bar = None
    for m in parts[0].findall("measure"):
        t = m.find("attributes/time")
        if t is not None and t.findtext("beats"):
            bar = int(t.findtext("beats")) * divisions * 4 // int(t.findtext("beat-type"))
        pos = 0
        ends = set()
        for el in m:
            if el.tag == "backup":
                ends.add(pos)
                pos -= int(el.findtext("duration"))
            elif el.tag == "forward":
                pos += int(el.findtext("duration"))
            elif el.tag == "note" and el.find("chord") is None and el.find("grace") is None:
                pos += int(el.findtext("duration") or 0)
        ends.add(pos)
        if pos < 0 or (len(ends) > 1 and max(ends) - min(ends) > divisions * 8):
            fail(n, f"measure {m.get('number')} voices do not line up")
            break
        if bar and max(ends) > bar:
            # a MuseScore bar stretched past its time signature with notes typed after a voice
            # (see OVERFLOW_REPAIRS in convert_mscz.py)
            fail(n, f"measure {m.get('number')} runs {max(ends) - bar} divisions past its time signature")
            break


def check_english(n: int, root, path: str) -> None:
    slots = melody_slots(root)
    verse = [s for s in slots if s.region == "verse"]
    refrain = [s for s in slots if s.region == "refrain"]
    for raw in open(path, encoding="utf-8"):
        if raw.startswith("#") or not raw.strip():
            continue
        tag, _, rest = raw.partition(":")
        tag = tag.strip()
        if rest.strip().startswith("!"):
            continue
        toks = rest.split()
        want = len(refrain) if tag == "r" else len(verse)
        if not re.fullmatch(r"v\d+|r", tag):
            fail(n, f"lyrics.en.txt: unknown line label '{tag}'")
        elif len(toks) != want:
            fail(n, f"lyrics.en.txt {tag}: {len(toks)} tokens for {want} melody notes")


def main() -> int:
    dirs = sorted(glob.glob(os.path.join(ROOT, "data/hymns/*")))
    if len(dirs) != 645:
        fail(None, f"expected 645 hymn folders, found {len(dirs)}")
    metas = {}
    for d in dirs:
        n = int(os.path.basename(d))
        try:
            meta = json.load(open(os.path.join(d, "meta.json"), encoding="utf-8"))
            metas[n] = meta
            root = etree.parse(os.path.join(d, "score.musicxml")).getroot()
        except Exception as e:  # noqa: BLE001
            fail(n, f"cannot read files ({e})")
            continue
        check_score(n, root)
        r = meta["rights"]
        if meta["publish"] and not meta.get("rights_override"):
            if r["tune"]["status"] not in ("pd_verified", "pd_likely") or r["text_en"]["status"] not in ("pd_verified", "pd_likely"):
                fail(n, "published but the tune or English text is not public domain")
            if r["text_ko"]["status"] == "gated":
                fail(n, "published but the Korean text is an original Korean work")
        en = os.path.join(d, "lyrics.en.txt")
        if meta["publish"] and os.path.exists(en):
            check_english(n, root, en)
        if not meta["publish"] and os.path.exists(en):
            fail(n, "gated hymn has an English file; its translation may be copyrighted")

    with open(os.path.join(ROOT, "data/acceptance.csv"), encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            n = int(row["number"])
            m = metas.get(n)
            if not m:
                fail(n, "acceptance row for a missing hymn")
                continue
            if m["title_ko"] != row["title_ko"]:
                fail(n, f"Korean title is '{m['title_ko']}', acceptance table says '{row['title_ko']}'")
            if row["old_number"] and str(m.get("old_number")) != row["old_number"]:
                fail(n, f"old number is {m.get('old_number')}, acceptance table says {row['old_number']}")
            if row["title_en"] and m["title_en"].lower().rstrip("!.") != row["title_en"].lower().rstrip("!."):
                fail(n, f"English title is '{m['title_en']}', acceptance table says '{row['title_en']}'")

    for f in glob.glob(os.path.join(ROOT, "src/**/*.ts*"), recursive=True) + [os.path.join(ROOT, "index.html")]:
        text = open(f, encoding="utf-8").read()
        if "—" in text or "&mdash;" in text:
            fail(None, f"{os.path.relpath(f, ROOT)} contains an em dash")
        if "·" in text or "&middot;" in text:
            fail(None, f"{os.path.relpath(f, ROOT)} contains a middle dot")

    if problems:
        print(f"{len(problems)} problem(s):")
        for p in problems:
            print("  -", p)
        return 1
    print(f"all checks passed: {len(dirs)} hymns, {sum(m['publish'] for m in metas.values())} published")
    return 0


if __name__ == "__main__":
    sys.exit(main())
