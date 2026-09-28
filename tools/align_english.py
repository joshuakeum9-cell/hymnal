"""Propose English lyric placement for each published hymn and write data/hymns/NNN/lyrics.en.txt.

English text: rupang21/hymnEngKorean hymns.json (hymnal-style hyphenated English, the original
public-domain wording for Western hymns). Only hymns whose meta.json says publish=true get an
English file, so copyrighted translations of Korean-authored hymns are never stored.

Placement is a small dynamic program over the melody notes. Putting an English syllable where
the Korean verse starts a syllable costs 0; putting one on a note the Korean holds costs 1
(2.5 inside a slur); leaving a Korean syllable note without a new English syllable costs 1.
The total cost per syllable becomes the quality grade written at the top of the file:
  exact  every English syllable sits exactly where a Korean syllable sits
  auto   a few differences, very likely right
  rough  many differences: the site shows English as text under the score instead
A human can fix any file by editing the tokens; `python tools/check_data.py` verifies counts.

Usage: python tools/align_english.py            (all published hymns, keeps files marked 'reviewed')
       python tools/align_english.py 405 300    (selected hymns, overwrites even reviewed files)
"""
from __future__ import annotations

import json
import os
import re
import sys

from lxml import etree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hymnlib import clean_english, english_syllables, korean_start, korean_verse_count, melody_slots  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INF = float("inf")
NL = chr(10)


def line_groups(verse: dict) -> list[tuple[str, str]]:
    """[(korean line, english text)], English lines with no Korean partner join the previous line."""
    groups: list[list[str]] = []
    for line in verse.get("lines", []):
        ko = "".join(re.findall(r"[가-힣]", line.get("ko") or ""))
        en = clean_english(line.get("en") or "").strip()
        if ko or not groups:
            groups.append([ko, en])
        else:
            groups[-1][1] = (groups[-1][1] + " " + en).strip()
    return [(g[0], g[1]) for g in groups if g[0] or g[1]]


PUNCT_END = re.compile(r"[,.;:!?][\"'’”)]*$")


def korean_line_ends(path, verse_no: int, groups) -> set[int]:
    """Path indices of the last note of each Korean line (from the source text's line breaks)."""
    starts = [i for i, s in enumerate(path) if korean_start(s, verse_no)]
    ends: set[int] = set()
    acc = 0
    lens = [len(g[0]) for g in groups if g[0]]
    for L in lens[:-1]:
        acc += L
        if 0 < acc <= len(starts):
            # the line ends on the note before the next line's first syllable
            nxt = starts[acc] if acc < len(starts) else len(path)
            ends.add(nxt - 1)
    return ends


def align(path, tokens, verse, line_ends=frozenset()):
    """Choose one note per English syllable. Returns (tokens per note, mismatch cost)."""
    n, t = len(path), len(tokens)
    if t == 0 or t > n:
        return None, INF
    ks = [korean_start(s, verse) for s in path]
    anchor = [path[i].phrase_end or i in line_ends for i in range(n)]
    punct = [bool(PUNCT_END.search(tok)) for tok in tokens]
    base_ch = [0.0 if ks[i] else (2.5 if path[i].slur_interior else 1.0) for i in range(n)]
    durs = sorted(s.dur for s in path) or [1]
    median = durs[len(durs) // 2] or 1

    def hold_cost(i: int) -> float:
        """Cost of holding the previous English syllable over a note the Korean sings a syllable on."""
        if not ks[i]:
            return 0.0
        c = 1.0
        prev = path[i - 1] if i > 0 else None
        if prev is not None and path[i].dur < prev.dur:
            c -= 0.35  # short note after a longer one: a typical English melisma
        if path[i].dur <= median // 2:
            c -= 0.15
        if path[i].downbeat:
            c += 0.4  # new syllables usually start on the downbeat
        if prev is not None and prev.phrase_end:
            c += 0.6  # never carry a syllable across a phrase break
        return c

    sk = [hold_cost(i) for i in range(n)]
    # a phrase-ending word (comma, period) should sit on a phrase-ending note, and the
    # syllable after it should start a new phrase
    def ch(i, j):
        c = base_ch[i]
        if punct[j]:
            c += 0.0 if anchor[i] else 0.6
        if j > 0 and punct[j - 1] and i > 0 and not anchor[i - 1]:
            c += 0.3
        return c
    dp = [[INF] * (t + 1) for _ in range(n + 1)]
    back = [[None] * (t + 1) for _ in range(n + 1)]
    dp[0][0] = 0.0
    for i in range(n):
        for j in range(t + 1):
            c = dp[i][j]
            if c == INF:
                continue
            if j < t:
                cc = c + ch(i, j)
                if cc < dp[i + 1][j + 1]:
                    dp[i + 1][j + 1] = cc
                    back[i + 1][j + 1] = "c"
            skip = (3.0 + (3.0 if ks[i] else 0.0)) if j == 0 else sk[i]
            if j == t and ks[i]:
                skip = 1.0  # English ran out: remaining Korean notes are held
            if c + skip < dp[i + 1][j]:
                dp[i + 1][j] = c + skip
                back[i + 1][j] = "s"
    if dp[n][t] == INF:
        return None, INF
    marks = []
    i, j = n, t
    while i > 0:
        m = back[i][j]
        marks.append(m)
        if m == "c":
            j -= 1
        i -= 1
    marks.reverse()
    out, k, mismatch = [], 0, 0.0
    for i, m in enumerate(marks):
        if m == "c":
            out.append(tokens[k])
            k += 1
            mismatch += base_ch[i]
        else:
            out.append("_" if k > 0 else ".")
            mismatch += sk[i] if k > 0 else (3.0 + (3.0 if ks[i] else 0.0))
    return out, mismatch


ELIDE_NEXT = re.compile(r"^(en|er|ry|el|ing|y|ous|ious|iour|our|ers|ry[,.;!?]?|en[,.;!?]?|er[,.;!?]?|el[,.;!?]?)$", re.I)


def elide(tokens: list[str], need: int) -> list[str]:
    """Merge `need` syllable pairs singers usually run together (ev-er-y, heav-en, pow-er, Sav-iour)."""
    toks = list(tokens)
    for _ in range(need):
        best, score = None, 0
        for i in range(len(toks) - 1):
            a, b = toks[i], toks[i + 1]
            if not a.endswith("-"):
                continue
            core_b = re.sub(r"[^A-Za-z']", "", b).lower()
            sc = 0
            if ELIDE_NEXT.match(core_b):
                sc += 2
            if core_b[:1] in "aeiouy":
                sc += 2
            if a.rstrip("-")[-1:].lower() in "aeiouwy":
                sc += 1
            if sc > score:
                best, score = i, sc
        if best is None:
            return toks
        toks[best:best + 2] = [toks[best].rstrip("-") + toks[best + 1]]
    return toks


def grade(cost: float, t: int) -> str:
    if cost == 0:
        return "exact"
    if cost / max(t, 1) <= 0.08 and cost <= 6:
        return "auto"
    return "rough"


def process(n: int, hymn_en: dict, force: bool) -> dict:
    d = os.path.join(ROOT, f"data/hymns/{n:03d}")
    meta = json.load(open(os.path.join(d, "meta.json"), encoding="utf-8"))
    out_path = os.path.join(d, "lyrics.en.txt")
    text_path = os.path.join(d, "english.txt")
    if not meta.get("publish"):
        for pth in (out_path, text_path):
            if os.path.exists(pth):
                os.remove(pth)
        return {"n": n, "status": "not published"}
    # plain verse text: shown under the score when the notes cannot carry it, and in print
    verses_txt = []
    for v in hymn_en.get("lyrics", []):
        lines = [clean_english(l["en"]).replace("-", "") for l in v.get("lines", []) if l.get("en")]
        if lines:
            verses_txt.append(NL.join(lines))
    if verses_txt and not (os.path.exists(text_path) and "status: reviewed" in open(text_path, encoding="utf-8").read(300)):
        with open(text_path, "w", encoding="utf-8", newline=NL) as fh:
            header = f"# {n} {meta['title_en']}: English words, one verse per block.{NL}# status: proposed{NL}{NL}"
            fh.write(header + (NL + NL).join(verses_txt) + NL)
    if os.path.exists(out_path) and not force:
        head = open(out_path, encoding="utf-8").read(400)
        if "status: reviewed" in head:
            return {"n": n, "status": "kept reviewed file"}
    root = etree.parse(os.path.join(d, "score.musicxml")).getroot()
    slots = melody_slots(root)
    kv = korean_verse_count(slots)
    src_verses = [v for v in hymn_en.get("lyrics", []) if any(l.get("en") for l in v.get("lines", []))]
    en_verses = [clean_english(" ".join(l["en"] for l in v["lines"] if l.get("en"))) for v in src_verses]
    has_refrain = any(s.region == "refrain" for s in slots)
    lines, costs, grades = [], [], []
    refrain_tokens = None
    for k in range(1, min(kv, len(en_verses)) + 1):
        toks = english_syllables(en_verses[k - 1])
        candidates = []
        groups = line_groups(src_verses[k - 1])
        paths = [slots]
        if k > 1 and has_refrain:
            paths.append([s for s in slots if s.region == "verse"])
        for path in paths:
            use = toks
            if 0 < len(toks) - len(path) <= 4:
                use = elide(toks, len(toks) - len(path))
            res, cost = align(path, use, k, korean_line_ends(path, k, groups))
            if res is not None:
                candidates.append((cost / max(len(toks), 1), cost, res, path))
        if not candidates:
            candidates.append((INF, INF, None, slots))
        candidates.sort(key=lambda c: c[0])
        _, cost, res, path = candidates[0]
        if res is None:
            lines.append(f"v{k}: ! could not place {len(toks)} syllables on {len(path)} notes")
            costs.append(INF)
            grades.append("rough")
            continue
        g = grade(cost, len(toks))
        grades.append(g)
        costs.append(cost)
        by_slot = {s.idx: tok for s, tok in zip(path, res)}
        verse_toks = [by_slot[s.idx] for s in slots if s.region == "verse" and s.idx in by_slot]
        lines.append(f"v{k}: " + " ".join(verse_toks))
        if k == 1 and has_refrain:
            refrain_tokens = [by_slot[s.idx] for s in slots if s.region == "refrain"]
    if refrain_tokens is not None:
        lines.insert(1, "r: " + " ".join(refrain_tokens))
    overall = "exact" if grades and all(g == "exact" for g in grades) else (
        "rough" if (not grades or "rough" in grades) else "auto")
    header = [
        f"# {n} {meta['title_en']}",
        "# English lyrics placed on the melody notes, one token per note, verse by verse.",
        "# word = syllable ends a word, syl- = continues on the next note, _ = hold (melisma), . = no English",
        "# Change status to 'reviewed' after checking against the book so the tool never overwrites it.",
        f"# quality: {overall} (per verse: {', '.join(grades) or 'none'})",
        "# status: proposed",
        "# source: rupang21/hymnEngKorean hymns.json (original public-domain English text)",
    ]
    with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(header + lines) + "\n")
    return {"n": n, "status": overall, "grades": grades, "korean_verses": kv, "english_verses": len(en_verses)}


def main(argv):
    hymns = json.load(open(os.path.join(ROOT, "work/meta/hymns.json"), encoding="utf-8"))
    by_num = {h["number"]: h for h in hymns}
    only = [int(a) for a in argv[1:]]
    nums = only or sorted(by_num)
    report = [process(n, by_num[n], force=bool(only)) for n in nums]
    summary = {}
    for r in report:
        summary[r["status"]] = summary.get(r["status"], 0) + 1
    print(summary)
    os.makedirs(os.path.join(ROOT, "work"), exist_ok=True)
    with open(os.path.join(ROOT, "work/align_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=0)


if __name__ == "__main__":
    main(sys.argv)
