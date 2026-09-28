"""Shared helpers: melody path, verse/refrain regions, English token format."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from lxml import etree

XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
VERSE_PREFIX = re.compile(r"^\s*(\d+)\s*[.]\s*")


@dataclass
class Slot:
    """One singable melody note: top note of staff 1 voice 1, not a tie continuation, not grace."""
    idx: int
    note: etree._Element
    measure: str
    ko: dict[int, str] = field(default_factory=dict)  # Korean verse -> syllable
    slur_interior: bool = False
    region: str = "verse"  # verse | refrain
    dur: int = 0            # sounding length incl. tied continuations (divisions)
    phrase_end: bool = False  # followed by a rest, a long note, or the end
    downbeat: bool = False    # first note of its measure


def melody_slots(root: etree._Element) -> list[Slot]:
    slots: list[Slot] = []
    open_slur = 0
    for m in root.iter("measure"):
        for n in m.findall("note"):
            if n.findtext("voice") != "1" or n.find("chord") is not None or n.find("rest") is not None:
                continue
            if n.find("grace") is not None:
                continue
            ties = [t.get("type") for t in n.findall("tie")]
            slur_types = [s.get("type") for s in n.findall("notations/slur")]
            interior = open_slur > 0
            d = int(n.findtext("duration") or 0)
            if "stop" in ties:
                # tie continuation: the syllable of the previous note carries on
                if slots:
                    slots[-1].dur += d
                open_slur += slur_types.count("start") - slur_types.count("stop")
                continue
            s = Slot(len(slots), n, m.get("number"), slur_interior=interior, dur=d)
            s.downbeat = not slots or slots[-1].measure != m.get("number")
            for ly in n.findall("lyric"):
                num = int(ly.get("number", "1"))
                txt = ly.findtext("text") or ""
                lang = ly.find("text").get(XML_LANG) if ly.find("text") is not None else "ko"
                if lang == "ko" and num % 2 == 1:
                    s.ko[(num + 1) // 2] = txt
            slots.append(s)
            open_slur += slur_types.count("start") - slur_types.count("stop")
            open_slur = max(open_slur, 0)
    mark_phrase_ends(root, slots)
    n_verses = max((v for s in slots for v in s.ko), default=1)
    if n_verses > 1:
        label = "verse"
        for s in slots:
            if s.ko:
                label = "refrain" if (1 in s.ko and all(v == 1 for v in s.ko)) else "verse"
            s.region = label
    return slots


def mark_phrase_ends(root, slots: list[Slot]) -> None:
    """A melody note ends a phrase when a rest follows it, it is long, or it has a fermata."""
    if not slots:
        return
    durs = sorted(s.dur for s in slots)
    median = durs[len(durs) // 2] or 1
    order = []
    for m in root.iter("measure"):
        for n in m.findall("note"):
            if n.findtext("voice") == "1" and n.find("chord") is None and n.find("grace") is None:
                order.append(n)
    pos = {id(n): i for i, n in enumerate(order)}
    ids = {id(s.note) for s in slots}
    for s in slots:
        i = pos.get(id(s.note))
        nxt = None
        if i is not None:
            j = i + 1
            while j < len(order) and id(order[j]) not in ids and order[j].find("rest") is None:
                j += 1
            nxt = order[j] if j < len(order) else None
        rest_after = nxt is not None and nxt.find("rest") is not None
        fermata = s.note.find("notations/fermata") is not None
        s.phrase_end = rest_after or fermata or nxt is None or s.dur >= 2 * median


def korean_verse_count(slots: list[Slot]) -> int:
    return max((v for s in slots for v in s.ko), default=0)


# ---- English token format (lyrics.en.txt) --------------------------------------------
# One token per slot on the line's path:
#   word       a whole word, or the last syllable of a word
#   syl-       a syllable that continues on the next token (hyphen)
#   _          hold the previous syllable on this note (melisma)
#   .          no English on this note (before the first syllable)

VOWELS = set("aeiouy")
ONSETS = {"bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "pl", "pr", "sc", "sk", "sl", "sm", "sn",
          "sp", "st", "sw", "tr", "tw", "th", "sh", "ch", "ph", "wh", "qu", "thr", "shr", "str", "spr", "scr"}
KEEP_LEFT = ("ght", "ck", "ng", "tch", "dge")
ONE_SYLLABLE = {"o'er", "e'er", "ne'er", "'tis", "'twas", "heav'n", "pow'r", "thro'", "tho'", "flow'r", "fire",
                "hour", "our", "prayer", "prayers", "choir", "hire", "desire'd"}
_cmu = None


def cmu_count(word: str) -> int | None:
    global _cmu
    if _cmu is None:
        try:
            import pronouncing  # type: ignore
            _cmu = pronouncing
        except Exception:
            _cmu = False
    if not _cmu:
        return None
    ph = _cmu.phones_for_word(word)
    return _cmu.syllable_count(ph[0]) if ph else None


def nuclei(core: str) -> list[tuple[int, int]]:
    """Vowel groups as (start, end) in a lowercase word, dropping a silent final e."""
    groups = []
    i = 0
    while i < len(core):
        if core[i] in VOWELS and not (core[i] == "y" and i == 0):
            j = i
            while j + 1 < len(core) and core[j + 1] in VOWELS:
                j += 1
            groups.append((i, j + 1))
            i = j + 1
        else:
            i += 1
    if len(groups) > 1:
        a, b = groups[-1]
        tail = core[a:]
        if tail == "e" or (tail in ("es", "ed") and not core[:a].endswith(("t", "d", "s", "c", "g", "z"))):
            if not (tail == "e" and core[:a].endswith("le") is False and a >= 2 and core[a - 1] == "l" and core[a - 2] not in VOWELS):
                groups.pop()
    return groups


_HYPH = None


def hymnal_split(core: str) -> list[str] | None:
    """The split hymnals use for this word (data/hyphenation.json), keeping the word's own letters."""
    global _HYPH
    if _HYPH is None:
        import json
        import os
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "hyphenation.json")
        _HYPH = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}
    h = _HYPH.get(core.lower())
    if not h:
        return None
    pieces, i = [], 0
    for part in h.split("-"):
        pieces.append(core[i:i + len(part)])
        i += len(part)
    return pieces


def split_word(word: str, use_dict: bool = True) -> list[str]:
    """Break one unhyphenated English word into sung syllables: 'Almighty' -> ['Al', 'might', 'y']."""
    lead = re.match(r"^[^A-Za-z']*", word).group(0)
    trail = re.search(r"[^A-Za-z']*$", word).group(0)
    core = word[len(lead):len(word) - len(trail)] if trail else word[len(lead):]
    low = core.lower()
    if not low or low in ONE_SYLLABLE:
        return [word]
    poss = ""
    if low.endswith("'s") and len(low) > 3:
        # possessive: split the word itself, the 's rides on the last syllable (Love's, Saviour's)
        core, low, poss = core[:-2], low[:-2], core[-2:]
        trail = poss + trail
    known = hymnal_split(core) if use_dict else None
    if known:
        known[0] = lead + known[0]
        known[-1] = known[-1] + trail
        return known
    if poss:
        parts = split_word(core, use_dict)
        parts[0] = lead + parts[0]
        parts[-1] = parts[-1] + trail
        return parts
    # a vowel dropped at the start of the second syllable is split the way hymnals print it:
    # wan-d'ring, mur-m'ring, con-qu'ring
    m = re.fullmatch(r"([a-z]*[aeiouy][a-z]*?)(qu|[bcdfghjklmnpqrstvwxz])'([bcdfghjklmnpqrstvwxz]?[aeiouy][a-z]*)", low)
    if m and len(m.group(1)) >= 2 and len(nuclei(low.replace("'", "_"))) == 2:
        k = len(m.group(1))
        return [lead + core[:k], core[k:] + trail]
    target = cmu_count(low.replace("'", ""))
    groups = nuclei(low.replace("'", "_"))
    if target is None:
        target = max(1, len(groups))
    if "'" in low:
        target = max(1, len(groups))  # elisions (ev'ry, wand'ring) are sung as written
    if target <= 1 or len(groups) < 2:
        return [word]
    cuts = []
    for (a1, b1), (a2, b2) in zip(groups, groups[1:]):
        cluster = low[b1:a2]
        if len(cluster) == 0:
            cuts.append(b1)
        elif len(cluster) == 1:
            cuts.append(b1)
        else:
            cut = None
            for k in KEEP_LEFT:
                if cluster.startswith(k):
                    cut = b1 + len(k)
            if cut is None:
                if cluster[-3:] in ONSETS and len(cluster) > 3:
                    cut = a2 - 3
                elif cluster[-2:] in ONSETS:
                    cut = a2 - 2
                else:
                    cut = b1 + 1 if cluster[0] != cluster[1] else b1 + 1
            cuts.append(min(max(cut, b1), a2))
    if low.endswith("ing") and len(groups) >= 2:
        cuts[-1] = len(low) - 3 if low[-4] != low[-5:-4] else len(low) - 3
    # adjust to the dictionary's syllable count
    while len(cuts) + 1 > target and cuts:
        cuts.pop(0 if len(cuts) > 1 and low.endswith(("ed", "es")) is False else -1)
    pieces, prev = [], 0
    for c in sorted(set(cuts)):
        if 0 < c < len(core):
            pieces.append(core[prev:c])
            prev = c
    pieces.append(core[prev:])
    pieces = [p for p in pieces if p]
    if len(pieces) == 1:
        return [word]
    pieces[0] = lead + pieces[0]
    pieces[-1] = pieces[-1] + trail
    return pieces


_FIXES = None
_JOINED = re.compile(r"(?i)\b(thro'|tho'|o'er|e'er|ne'er|'tis|'twas)(?=[a-z])")


def clean_english(text: str) -> str:
    """Apply data/english_fixes.json and repair joins such as "Thro'loss" (a missing space eats a syllable)."""
    global _FIXES
    if _FIXES is None:
        import json
        import os
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "english_fixes.json")
        raw = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}
        _FIXES = [(re.compile(r"(?i)(?<![A-Za-z'-])" + re.escape(k) + r"(?![A-Za-z])"), v)
                  for k, v in sorted(raw.items(), key=lambda kv: -len(kv[0])) if not k.startswith("_")]
    text = _JOINED.sub(lambda m: m.group(1) + " ", text)
    text = re.sub(r"([,;:!?])(?=[A-Za-z])", r"\1 ", text)  # "cross,I" -> "cross, I"
    text = re.sub(r"(?<=[a-z])\.(?=[A-Z])", ". ", text)     # "arms.What" -> "arms. What"
    for rx, rep in _FIXES:
        def sub(m, rep=rep):
            w = m.group(0)
            return rep[0].upper() + rep[1:] if w[:1].isupper() else rep
        text = rx.sub(sub, text)
    return text


def english_syllables(text: str, use_dict: bool = True) -> list[str]:
    """'What a fel-low-ship, Holy' -> ['What', 'a', 'fel-', 'low-', 'ship,', 'Ho-', 'ly']"""
    out: list[str] = []
    text = text.replace("—", "— ").replace("–", "– ")
    for word in text.split():
        if "~" in word:
            out.append(word)  # words joined with ~ share one note ("of~the")
            continue
        if not re.search(r"[A-Za-z]", word):
            if out:
                out[-1] = out[-1] + word if not out[-1].endswith("-") else out[-1]
            continue
        if re.search(r"[A-Za-z’'.,;:!?]-+[A-Za-z]", word):
            parts = [p for p in re.split(r"-+", word) if p]
        else:
            parts = split_word(word, use_dict)
        for i, p in enumerate(parts):
            out.append(p + ("-" if i < len(parts) - 1 else ""))
    return out


def verse_path(slots: list[Slot], verse: int) -> list[Slot]:
    return [s for s in slots if s.region == "verse" or verse == 1 or s.region == "refrain"]


def korean_start(s: Slot, verse: int) -> bool:
    if s.region == "refrain":
        return 1 in s.ko
    return verse in s.ko
