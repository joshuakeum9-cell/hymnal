"""Make the English under the notes read exactly as the Korean-English (한영) hymnal prints it.

tools/fetch_hanyoung.py saves the book's English per hymn (work/hanyoung/NNN.json). Our placed
English (data/hymns/NNN/lyrics.en.txt) comes from another source whose spelling and wording differ
in places: "heav'n" / "heaven", "Saviour" / "Savior", typos, a different line, a missing Amen.

For each verse this lines the two texts up word by word and keeps our note placement:
  same word, other spelling or punctuation   the book's spelling on the same notes
  one word for one word, same syllables      the book's word on the same notes
Anything else (added or dropped words, a different line) is listed in the report and left for a
full re-placement with the book's text (--realign writes data/english_overrides/NNN.txt for those
and runs align_english.py, keeping the result only when its grade is not worse).

Usage: python tools/apply_hanyoung.py [--realign] [NNN ...]
Report: work/hanyoung_report.json
"""
from __future__ import annotations

import difflib
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hymnlib import clean_english, english_syllables, melody_slots  # noqa: E402
from align_english import elide  # noqa: E402
from lxml import etree  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NL = "\n"
RANK = {"exact": 0, "auto": 1, "rough": 2}


def norm(w: str) -> str:
    """Compare words by sound, not spelling: heav'n = heaven, Saviour = Savior, o'er = over."""
    w = w.lower().replace("’", "'")
    w = re.sub(r"[^a-z']", "", w)
    w = {"o'er": "over", "e'er": "ever", "ne'er": "never", "thro'": "through", "tho'": "though",
         "'tis": "tis", "'twas": "twas", "'mid": "amid", "'neath": "beneath"}.get(w, w)
    w = w.replace("'", "").replace("saviour", "savior").replace("honour", "honor").replace("colour", "color")
    return w


def book_words(text: str) -> list[str]:
    text = clean_english(text.replace("\n", " "))
    return [w for w in text.split() if re.search(r"[A-Za-z]", w)]


def read_tokens(path: str):
    lines = open(path, encoding="utf-8").read().split(NL)
    body = {}
    for i, l in enumerate(lines):
        m = re.match(r"^(v\d+|r):\s?(.*)$", l)
        if m:
            body[m.group(1)] = (i, m.group(2).split())
    return lines, body


def words_of(tokens: list[str]):
    """Group note tokens into words: [(word text, [token indexes])]."""
    out, cur = [], []
    for i, t in enumerate(tokens):
        if t in ("_", "."):
            continue
        cur.append(i)
        if not t.endswith("-"):
            out.append(("".join(tokens[j].rstrip("-") for j in cur), cur))
            cur = []
    if cur:
        out.append(("".join(tokens[j].rstrip("-") for j in cur), cur))
    return out


def respell(tokens, idxs, new_word) -> bool:
    """Put new_word on the notes of an old word. True when it fits the same number of syllables."""
    n = len(idxs)
    if n == 1:
        tokens[idxs[0]] = new_word
        return True
    parts = english_syllables(new_word)
    if len(parts) != n:
        parts = english_syllables(new_word, use_dict=False)
    if len(parts) > n:
        # printed in full but sung contracted: "heavenly" on the two notes of "heav'n-ly"
        parts = elide(parts, len(parts) - n)
    if len(parts) != n:
        return False
    for i, p in zip(idxs, parts):
        tokens[i] = p
    return True


def apply_verse(tokens: list[str], book: list[str], allow_tail: bool, amen_notes: list[int] | None = None):
    """Returns (new tokens, list of problems).

    amen_notes: token positions of the Korean 아멘 at the end of this verse, if any."""
    tokens = list(tokens)
    if amen_notes and [norm(w) for w in book[-1:]] == ["amen"] and all(tokens[i] in ("_", ".") for i in amen_notes):
        # the book ends the verse with Amen and our placement left the 아멘 notes empty
        tokens[amen_notes[0]], tokens[amen_notes[1]] = "A-", book[-1][1:] if book[-1][:1] in "Aa" else "men."
    ours = words_of(tokens)
    a = [norm(w) for w, _ in ours]
    b = [norm(w) for w in book]
    problems = []
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                w, idxs = ours[i1 + k]
                if w != book[j1 + k] and not respell(tokens, idxs, book[j1 + k]):
                    problems.append(f"spelling {w!r} -> {book[j1 + k]!r} does not fit its notes")
        elif tag == "replace" and (i2 - i1 != j2 - j1 or not all(
                respell(list(tokens), ours[i1 + k][1], book[j1 + k]) for k in range(i2 - i1))):
            # words split or joined differently ("Godin" / "God in", "wood lands" / "woodlands"):
            # spread the book's syllables over the same notes when the count works out
            idxs = [i for _, ix in ours[i1:i2] for i in ix]
            pieces = [p for w in book[j1:j2] for p in english_syllables(w)]
            if len(pieces) > len(idxs):
                pieces = elide(pieces, len(pieces) - len(idxs))
            if len(pieces) == len(idxs):
                for i, p in zip(idxs, pieces):
                    tokens[i] = p
            else:
                problems.append(f"replace: ours {' '.join(w for w, _ in ours[i1:i2])!r} / book {' '.join(book[j1:j2])!r}")
        elif tag == "replace":
            for k in range(i2 - i1):
                respell(tokens, ours[i1 + k][1], book[j1 + k])
        elif tag == "insert" and allow_tail and i1 == len(a):
            continue  # the book repeats the refrain after every verse; we sing it once
        else:
            problems.append(f"{tag}: ours {' '.join(w for w, _ in ours[i1:i2])!r} / book {' '.join(book[j1:j2])!r}")
    return tokens, problems


def process(n: int) -> dict:
    hp = os.path.join(ROOT, f"work/hanyoung/{n:03d}.json")
    lp = os.path.join(ROOT, f"data/hymns/{n:03d}/lyrics.en.txt")
    if not (os.path.exists(hp) and os.path.exists(lp)):
        return {"n": n, "status": "no data"}
    hy = json.load(open(hp, encoding="utf-8"))
    if not hy.get("en"):
        return {"n": n, "status": "book has no English"}
    lines, body = read_tokens(lp)
    head = "\n".join(lines[:12])
    if "status: reviewed" in head:
        return {"n": n, "status": "kept reviewed file"}
    verses = sorted((k for k in body if k.startswith("v")), key=lambda k: int(k[1:]))
    has_r = "r" in body
    slots = melody_slots(etree.parse(os.path.join(ROOT, f"data/hymns/{n:03d}/score.musicxml")).getroot())
    vslots = [s for s in slots if s.region == "verse"] if has_r else slots

    def amen_positions(k: int):
        """Token positions of a final 아멘 in Korean verse k (two notes: 아, 멘)."""
        path = vslots if not (k == 1 and has_r) else slots
        sung = [(i, s) for i, s in enumerate(path) if (s.ko.get(k) or s.ko.get(1) if s.region == "refrain" else s.ko.get(k))]
        if len(sung) >= 2 and [x[1].ko.get(k) or x[1].ko.get(1) for x in sung[-2:]] == ["아", "멘"]:
            return [sung[-2][0], sung[-1][0]]
        return None
    result = {"n": n, "status": "ok", "problems": {}, "changed": 0}
    new_lines = list(lines)
    for vk in verses:
        k = int(vk[1:])
        if k > len(hy["en"]):
            result["problems"][vk] = ["book has fewer verses"]
            continue
        book = book_words(hy["en"][k - 1])
        idx, toks = body[vk]
        if k == 1 and has_r:
            ridx, rtoks = body["r"]
            joined, probs = apply_verse(toks + rtoks, book, allow_tail=False, amen_notes=amen_positions(k))
            new_v, new_r = joined[:len(toks)], joined[len(toks):]
            new_lines[ridx] = "r: " + " ".join(new_r)
        else:
            new_v, probs = apply_verse(toks, book, allow_tail=has_r, amen_notes=amen_positions(k))
        if probs:
            result["problems"][vk] = probs
        if new_v != toks:
            result["changed"] += sum(x != y for x, y in zip(new_v, toks))
        new_lines[idx] = f"{vk}: " + " ".join(new_v)
    if result["problems"]:
        result["status"] = "needs realign"
    if new_lines != lines:
        text = NL.join(new_lines)
        if "# wording:" not in text:
            text = text.replace("# status:", "# wording: Korean-English hymnal (prayertents.com)\n# status:", 1)
        open(lp, "w", encoding="utf-8", newline=NL).write(text)
    result["quality"] = re.search(r"quality: (\w+)", head).group(1) if "quality:" in head else None
    # the plain verse text (shown when the notes cannot carry the words, and in print) follows the book too
    tp = os.path.join(ROOT, f"data/hymns/{n:03d}/english.txt")
    if not result["problems"] and os.path.exists(tp) and "status: reviewed" not in open(tp, encoding="utf-8").read(300):
        first = open(tp, encoding="utf-8").read().split(NL)[0]
        verses = [clean_english(v.strip()) for v in hy["en"][:len(verses)]]
        open(tp, "w", encoding="utf-8", newline=NL).write(
            f"{first}{NL}# status: proposed (Korean-English hymnal wording){NL}{NL}" + (NL + NL).join(verses) + NL)
    return result


def realign(n: int, hy: dict) -> str:
    """Re-place the book's English from scratch; keep it only if the grade is not worse."""
    lp = os.path.join(ROOT, f"data/hymns/{n:03d}/lyrics.en.txt")
    before = open(lp, encoding="utf-8").read()
    old_q = re.search(r"quality: (\w+)", before).group(1)
    ov = os.path.join(ROOT, f"data/english_overrides/{n:03d}.txt")
    if os.path.exists(ov):
        return "has override already"
    body = f"# {n} English as printed in the Korean-English hymnal, source: https://www.prayertents.com/hymns?nh={n}{NL}"
    body += (NL + NL).join(v.strip() for v in hy["en"]) + NL
    open(ov, "w", encoding="utf-8", newline=NL).write(body)
    subprocess.run([sys.executable, os.path.join(ROOT, "tools/align_english.py"), str(n)], capture_output=True)
    after = open(lp, encoding="utf-8").read()
    new_q = re.search(r"quality: (\w+)", after).group(1)
    if RANK.get(new_q, 3) > RANK.get(old_q, 3):
        os.remove(ov)
        open(lp, "w", encoding="utf-8", newline=NL).write(before)
        return f"kept old placement ({old_q}); book text placed as {new_q}"
    return f"re-placed with book text ({old_q} -> {new_q})"


def main(argv):
    do_realign = "--realign" in argv
    nums = [int(a) for a in argv[1:] if a.isdigit()]
    if not nums:
        nums = sorted(int(f[:3]) for f in os.listdir(os.path.join(ROOT, "work/hanyoung")) if f.endswith(".json"))
    report = []
    for n in nums:
        r = process(n)
        if do_realign and (r["status"] == "needs realign" or r.get("quality") == "rough"):
            hy = json.load(open(os.path.join(ROOT, f"work/hanyoung/{n:03d}.json"), encoding="utf-8"))
            r["realign"] = realign(n, hy)
        report.append(r)
    json.dump(report, open(os.path.join(ROOT, "work/hanyoung_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    summary: dict[str, int] = {}
    for r in report:
        summary[r["status"]] = summary.get(r["status"], 0) + 1
    print(summary, "notes changed:", sum(r.get("changed", 0) for r in report))


if __name__ == "__main__":
    main(sys.argv)
