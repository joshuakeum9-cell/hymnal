"""Where each English syllable starts, taken from the Open Hymnal Project's hand-engraved scores.

The Open Hymnal (openhymnal.org, public domain) prints about 290 hymns with the English words
under the notes. For our hymns that use the same tune, this matches its melody to ours note by
note and records, per English verse, which of our melody notes start a syllable (S) and which
hold one (H). align_english.py uses that pattern before its own guesswork.

Output: data/openhymnal_patterns.json
  {"149": {"tune": "When I Survey the Wondrous Cross", "verses": [{"words": "...", "flags": "S.SHS..."}]}}
  flags has one character per melody note (hymnlib.melody_slots order): S start, H hold, . none.

Usage: python tools/openhymnal_patterns.py   (downloads work/openhymnal.abc the first time)
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys
import urllib.request

from lxml import etree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from abc_lyrics import parse_tune, syllables  # noqa: E402
from hymnlib import melody_slots  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ABC = os.path.join(ROOT, "work", "openhymnal.abc")
URL = "http://openhymnal.org/OpenHymnal2014.06.abc"
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi_of(n) -> int:
    p = n.find("pitch")
    return (int(p.findtext("octave")) + 1) * 12 + STEP[p.findtext("step")] + int(float(p.findtext("alter") or 0))


def norm(t: str) -> list[str]:
    return re.sub(r"[^a-z ]", "", t.lower().replace("'", "").replace("’", "")).split()


def events(notes, verse_seq):
    """One entry per sounding OH melody note (ties merged): start flag and syllable for this verse."""
    ev, idx = [], {}
    for i, n in enumerate(notes):
        if n.get("rest") or (n.get("tie_prev") and ev):
            continue
        idx[i] = len(ev)
        ev.append({"midi": n["midi"], "start": None, "text": None})
    for st, en, wl in verse_seq:
        if wl is None:
            continue
        items = syllables(wl)
        k = 0
        for i in range(st, en):
            if notes[i].get("rest"):
                continue
            if k >= len(items):
                break
            it = items[k]
            k += 1
            if i not in idx:
                continue  # a tie continuation takes a lyric slot (usually *) but sings nothing new
            e = ev[idx[i]]
            e["start"] = it[0] == "start"
            if e["start"]:
                e["text"] = it[1]
    return ev


def lcs(a, b):
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            dp[i][j] = dp[i + 1][j + 1] + 1 if a[i] == b[j] else max(dp[i + 1][j], dp[i][j + 1])
    i = j = 0
    out = []
    while i < n and j < m:
        if a[i] == b[j]:
            out.append((i, j))
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return out


def main():
    if not os.path.exists(ABC):
        os.makedirs(os.path.dirname(ABC), exist_ok=True)
        urllib.request.urlretrieve(URL, ABC)
    tunes = re.split(r"\n(?=X:)", open(ABC, encoding="utf-8", errors="replace").read())
    titled = [(re.findall(r"^T:\s*(.*?)\s*$", t, re.M)[0], t) for t in tunes if re.search(r"^T:", t, re.M)]
    out, skipped = {}, []
    for p in sorted(glob.glob(os.path.join(ROOT, "data/hymns/*/meta.json"))):
        m = json.load(open(p, encoding="utf-8"))
        n = m["number"]
        if not m.get("publish"):
            continue
        tw = norm(m.get("original_title") or m["title_en"])
        k = min(len(tw), 6)
        best = (0.0, None, None)
        for title, t in titled:
            ow = norm(title)
            if ow and k:
                sc = sum(a == b for a, b in zip(tw[:k], ow[:k])) / k
                if sc > best[0]:
                    best = (sc, title, t)
        if best[0] < 0.8:
            continue
        notes, verses, repeat = parse_tune(best[2])
        if repeat or not verses:
            skipped.append((n, "repeats in the Open Hymnal score"))
            continue
        slots = melody_slots(etree.parse(os.path.join(os.path.dirname(p), "score.musicxml")).getroot())
        ours = [midi_of(s.note) for s in slots]
        theirs = [e["midi"] for e in events(notes, verses[0])]
        al = max((lcs(ours, [x + sh for x in theirs]) for sh in range(-12, 13)), key=len)
        # the same melody: nearly every Open Hymnal note found in ours, and ours has few extra notes
        # (an added Amen or a split note is fine; a different tune or arrangement is not)
        if len(al) < 0.97 * len(theirs) or len(al) < 0.85 * len(ours):
            skipped.append((n, f"melody differs ({len(al)} of {len(theirs)} Open Hymnal notes, {len(ours)} ours)"))
            continue
        at = dict(al)
        vs_out = []
        for vs in verses:
            ev = events(notes, vs)
            flags, started = [], False
            for i in range(len(slots)):
                j = at.get(i)
                st = ev[j]["start"] if j is not None else None
                if st:
                    flags.append("S")
                    started = True
                else:
                    flags.append("H" if started else ".")
            words = " ".join(e["text"] for e in ev if e["text"])
            vs_out.append({"words": " ".join(norm(words)[:10]), "flags": "".join(flags)})
        out[str(n)] = {"tune": best[1], "verses": vs_out}
    path = os.path.join(ROOT, "data/openhymnal_patterns.json")
    json.dump(out, open(path, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1, sort_keys=True)
    print(len(out), "hymns with Open Hymnal patterns;", len(skipped), "skipped")
    for s in skipped:
        print("  ", *s)


if __name__ == "__main__":
    main()
