"""Build the website's data from data/hymns/*.

Outputs (both git-ignored, rebuilt by CI on every deploy):
  public/hymns/NNN.<hash>.json   one file per published hymn: MusicXML with Korean + English
                                 lyric lines merged in, plus verse text for print and fallback
  src/generated/index.json       the search index for all 645 hymns (gated ones have file null)
  src/generated/hangul.txt       every Hangul character used, for the font subset

Lyric numbering in the merged MusicXML: Korean verse k = 2k-1, English verse k = 2k.
Both engines stack lyric lines in number order, so each Korean line sits above its English line,
the way the printed bilingual hymnal does it.

Usage: python tools/build_data.py [--church-only]
  --church-only also publishes gated hymns (never deploy that build publicly)
"""
from __future__ import annotations

import glob
import hashlib
import json
import os
import re
import shutil
import sys

from lxml import etree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hymnlib import XML_LANG, VERSE_PREFIX, melody_slots  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"


def choseong(s: str) -> str:
    out = []
    for ch in s:
        c = ord(ch)
        if 0xAC00 <= c <= 0xD7A3:
            out.append(CHO[(c - 0xAC00) // 588])
        elif ch.strip():
            out.append(ch)
    return "".join(out)


def parse_en(path: str) -> tuple[dict, str]:
    """Returns ({'v1': [...], 'r': [...]}, quality)."""
    lines, quality = {}, "none"
    if not os.path.exists(path):
        return lines, quality
    for raw in open(path, encoding="utf-8"):
        raw = raw.rstrip("\n")
        if raw.startswith("# quality:"):
            quality = raw.split(":", 1)[1].split()[0]
            continue
        if not raw.strip() or raw.startswith("#"):
            continue
        tag, _, rest = raw.partition(":")
        if rest.strip().startswith("!"):
            lines[tag.strip()] = None
            continue
        lines[tag.strip()] = rest.split()
    return lines, quality


def token_text(tok: str) -> tuple[str, bool]:
    """'fel-' -> ('fel', True)."""
    if tok.endswith("-") and len(tok) > 1:
        return tok[:-1], True
    return tok, False


def add_english(root, slots, en: dict) -> int:
    """Insert English lyric elements. Returns the number of English verses placed."""
    verse_slots = [s for s in slots if s.region == "verse"]
    refrain_slots = [s for s in slots if s.region == "refrain"]
    placed = 0
    for tag, toks in en.items():
        if toks is None:
            continue
        if tag == "r":
            path, k = refrain_slots, 1
        else:
            m = re.fullmatch(r"v(\d+)", tag)
            if not m:
                continue
            path, k = verse_slots, int(m.group(1))
        if len(toks) != len(path):
            raise ValueError(f"{tag}: {len(toks)} tokens for {len(path)} notes")
        cont = False  # previous syllable continues (hyphen)
        last_lyric = None
        first = True
        for s, tok in zip(path, toks):
            if tok == ".":
                continue
            if tok == "_":
                if last_lyric is not None and not cont and last_lyric.find("extend") is None:
                    etree.SubElement(last_lyric, "extend")
                continue
            text, hyph = token_text(tok)
            if first and tag != "r":
                text = f"{k}. {text}"
            first = False
            syl = ("middle" if hyph else "end") if cont else ("begin" if hyph else "single")
            ly = make_lyric(s.note, 2 * k, syl, text, "en")
            last_lyric = ly
            cont = hyph
        if tag != "r":
            placed += 1
    return placed


def make_lyric(note, number: int, syllabic: str, text: str, lang: str):
    ly = etree.Element("lyric", number=str(number))
    etree.SubElement(ly, "syllabic").text = syllabic
    t = etree.SubElement(ly, "text")
    t.text = text
    t.set(XML_LANG, lang)
    # keep lyric elements ordered by number
    existing = note.findall("lyric")
    after = None
    for e in existing:
        if int(e.get("number", "1")) < number:
            after = e
    if after is not None:
        after.addnext(ly)
    elif existing:
        existing[0].addprevious(ly)
    else:
        note.append(ly)
    return ly


def korean_verse_text(slots, k: int) -> str:
    out = []
    for s in slots:
        syl = s.ko.get(k) if s.region == "verse" else s.ko.get(1)
        if syl:
            out.append(VERSE_PREFIX.sub("", syl))
    return "".join(out)


def read_english_text(path: str) -> list[str]:
    if not os.path.exists(path):
        return []
    body = "".join(l for l in open(path, encoding="utf-8") if not l.startswith("#"))
    return [b.strip() for b in re.split(r"\n\s*\n", body) if b.strip()]


def person(credit: str) -> str:
    """'엘리샤 호프만 (Elisha Albright Hoffman) · 1839~1929' -> 'Elisha Albright Hoffman (1839~1929)'."""
    if not credit:
        return ""
    credit = " ".join(credit.split())
    years = re.search(r"(1[4-9]\d\d)\s*~\s*(1[4-9]\d\d|20\d\d|\?)", credit)
    m = re.search(r"\(([^()]*[A-Za-z][^()]*)\)", credit)
    name = (m.group(1) if m else credit.split("·")[0]).strip()
    name = re.sub(r"\s+", " ", name)
    if years and years.group(0) not in name:
        name += f" ({years.group(1)}~{years.group(2)})"
    return name


def credit_line(meta: dict) -> str:
    words = person(meta.get("lyricist", "")) or meta.get("credit_line_in_file", {}).get("lyricist", "")
    music = person(meta.get("composer", "")) or meta.get("credit_line_in_file", {}).get("composer", "")
    parts = []
    if words:
        parts.append(f"Words: {words}.")
    if music:
        parts.append(f"Music: {music}.")
    return " ".join(parts)


def main(argv):
    church_only = "--church-only" in argv
    english_all = "--english-all" in argv  # preview: also place 'rough' English under the notes
    out_dir = os.path.join(ROOT, "public/hymns")
    gen_dir = os.path.join(ROOT, "src/generated")
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir)
    os.makedirs(gen_dir, exist_ok=True)
    index, hangul = [], set("찬송가새통일검색악보가사한영조옮기인쇄설정목록이전다음원래키장절후렴")
    stats = {"published": 0, "gated": 0, "en_notes": 0, "en_text": 0}
    for d in sorted(glob.glob(os.path.join(ROOT, "data/hymns/*"))):
        n = int(os.path.basename(d))
        meta = json.load(open(os.path.join(d, "meta.json"), encoding="utf-8"))
        publish = meta["publish"] or church_only
        for ch in meta["title_ko"]:
            if 0xAC00 <= ord(ch) <= 0xD7A3:
                hangul.add(ch)
        row = {
            "n": n, "o": meta.get("old_number"), "k": meta["title_ko"], "e": meta["title_en"],
            "c": choseong(meta["title_ko"]), "t": meta.get("theme", ""),
            "kt": meta.get("key_table", ""), "ts": meta.get("time_table", ""),
        }
        if not publish:
            row["f"] = None
            row["g"] = 1 if meta.get("korean_authored") else 2
            index.append(row)
            stats["gated"] += 1
            continue
        root = etree.parse(os.path.join(d, "score.musicxml"), etree.XMLParser(remove_blank_text=True)).getroot()
        slots = melody_slots(root)
        kv = max((v for s in slots for v in s.ko), default=0)
        en, quality = parse_en(os.path.join(d, "lyrics.en.txt"))
        en_mode = 0
        if en and (quality in ("exact", "auto", "reviewed") or english_all):
            try:
                add_english(root, slots, en)
                en_mode = 1
            except ValueError as e:
                print(f"{n}: English not merged ({e})")
        text_en = read_english_text(os.path.join(d, "english.txt"))[:max(kv, 1)]
        if en_mode == 0 and text_en:
            en_mode = 2
        # declare lyric languages for other software
        defaults = root.find("defaults")
        for num in sorted({int(ly.get("number")) for ly in root.iter("lyric")}):
            ll = etree.SubElement(defaults, "lyric-language", number=str(num))
            ll.set(XML_LANG, "ko" if num % 2 else "en")
        xml = etree.tostring(root, encoding="unicode")
        text_ko = [korean_verse_text(slots, k) for k in range(1, kv + 1)]
        for t in text_ko:
            hangul.update(ch for ch in t if 0xAC00 <= ord(ch) <= 0xD7A3)
        key = root.find(".//key")
        fifths = int(key.findtext("fifths")) if key is not None else 0
        mode = key.findtext("mode") if key is not None else "major"
        payload = {"n": n, "xml": xml, "ko": text_ko, "en": text_en, "enMode": en_mode, "cr": credit_line(meta)}
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        h = hashlib.sha256(body).hexdigest()[:8]
        fname = f"{n:03d}.{h}.json"
        with open(os.path.join(out_dir, fname), "wb") as fh:
            fh.write(body)
        row.update({"f": fname, "fi": fifths, "m": 1 if mode == "minor" else 0, "v": kv, "en": en_mode})
        index.append(row)
        stats["published"] += 1
        stats["en_notes" if en_mode == 1 else "en_text"] += 1 if en_mode else 0
    sample = next((r["f"] for r in index if r["n"] == 405 and r.get("f")), None) or next(r["f"] for r in index if r.get("f"))
    with open(os.path.join(out_dir, "sample.txt"), "w", encoding="utf-8") as fh:
        fh.write(sample)  # CI checks that this file is served gzip-compressed
    with open(os.path.join(gen_dir, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(gen_dir, "hangul.txt"), "w", encoding="utf-8") as fh:
        fh.write("".join(sorted(hangul)))
    print(stats, "hangul chars:", len(hangul))


if __name__ == "__main__":
    main(sys.argv)
