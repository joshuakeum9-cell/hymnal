"""Praise songs: a lead sheet in ABC -> MusicXML in the hymn format.

A praise song is one staff: the melody, its words (one or more verses), and chord letters.
Source: data/praise/NN/song.abc (NN = the song's place in the praise list). Supported ABC:

  X: T: title   K: key (G, Em, Bb, F#m)   M: time (4/4, 3/4, 6/8, C)   L: unit length (default 1/8)
  N: notes and % comments are skipped
  notes      ^C _B =F  C, C c c'  with lengths 2 3 4 / /2 3/2 and broken rhythm > <
  rests      z z2
  ties       C2-C    slurs ( )  ignored      triplets (3abc
  chords     "G" "Am" "D/F#" "E7" written before a note or rest; a song with none gets
             letters from tools/harmonize.py
  bars       |  ||  |]  |:  :|  ::  :|]   endings [1 [2 [1,3 [2,4
  inline     [M:2/4] [K:G] where the time or key changes
  marks      !segno! !coda! !D.S.! !D.C.! !fine!
  words      w: lines after a music line, one w: line per verse, standard ABC: every note
             (tied continuations too) takes one word token; '-' splits a word into syllables;
             '_' holds the previous syllable over a note; '*' leaves a note without a word;
             '~' joins two words on one note. A token of several Hangul characters stays on one
             note (Hebrew sung in Hangul).

Lyric numbers follow the hymns: verse k is lyric 2k-1, its first syllable prefixed 'k.'
when the song has more than one verse.

Usage: python tools/leadsheet.py NN [NN ...]     check, and write data/praise/NN/score.musicxml
       python tools/leadsheet.py all
"""
from __future__ import annotations

import glob
import os
import re
import sys
from fractions import Fraction as F

from lxml import etree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harmonize import harmonize  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIV = 96  # divisions per quarter
STEPS = "CDEFGAB"
MAJOR_FIFTHS = {"C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7, "F": -1, "Bb": -2,
                "Eb": -3, "Ab": -4, "Db": -5, "Gb": -6, "Cb": -7}
KINDS = {"": "major", "m": "minor", "7": "dominant", "maj7": "major-seventh", "m7": "minor-seventh",
         "sus4": "suspended-fourth", "dim": "diminished", "aug": "augmented", "+": "augmented",
         "m7b5": "half-diminished", "dim7": "diminished-seventh", "sus": "suspended-fourth",
         "6": "major-sixth", "m6": "minor-sixth", "9": "dominant-ninth", "add9": "major"}
TYPES = [(F(4), "whole", 0), (F(3), "half", 1), (F(2), "half", 0), (F(3, 2), "quarter", 1), (F(1), "quarter", 0),
         (F(3, 4), "eighth", 1), (F(1, 2), "eighth", 0), (F(3, 8), "16th", 1), (F(1, 4), "16th", 0),
         (F(1, 8), "32nd", 0), (F(7, 2), "half", 2), (F(7, 4), "quarter", 2), (F(6), "whole", 1)]
HANGUL = re.compile(r"[가-힣]")
MARKS = {"segno": "segno", "coda": "coda", "D.S.": "D.S.", "D.C.": "D.C.", "fine": "Fine"}


class AbcError(Exception):
    pass


def key_fifths(k: str) -> tuple[int, str]:
    k = k.strip().split()[0]
    m = re.fullmatch(r"([A-G][#b]?)(m|min|maj)?", k)
    if not m:
        raise AbcError(f"key {k!r}")
    tonic, q = m.group(1), m.group(2)
    if q in ("m", "min"):
        rel = {"A": "C", "E": "G", "B": "D", "F#": "A", "C#": "E", "G#": "B", "D#": "F#", "D": "F", "G": "Bb",
               "C": "Eb", "F": "Ab", "Bb": "Db", "Eb": "Gb"}[tonic]
        return MAJOR_FIFTHS[rel], "minor"
    return MAJOR_FIFTHS[tonic], "major"


def key_alters(fifths: int) -> dict[str, int]:
    order_sharp, order_flat = "FCGDAEB", "BEADGCF"
    if fifths >= 0:
        return {s: 1 for s in order_sharp[:fifths]}
    return {s: -1 for s in order_flat[:-fifths]}


def parse_meter(m: str) -> tuple[int, int]:
    m = m.strip().replace("C|", "2/2").replace("C", "4/4")
    beats, beat_type = (int(x) for x in m.split("/"))
    return beats, beat_type


def parse_length(s: str) -> F:
    if not s:
        return F(1)
    if re.fullmatch(r"/+", s):
        return F(1, 2 ** len(s))
    m = re.fullmatch(r"(\d*)(/(\d*))?", s)
    if not m:
        raise AbcError(f"length {s!r}")
    num = int(m.group(1)) if m.group(1) else 1
    if m.group(2) is None:
        return F(num)
    den = int(m.group(3)) if m.group(3) else 2
    return F(num, den)


TOKEN = re.compile(r'"(?P<chord>[^"]*)"|!(?P<mark>[^!\s]+)!|\[(?P<field>[KML]):(?P<fval>[^\]]*)\]|'
                   r'\[(?P<ending>\d(?:,\d)*)|(?P<bar>:\|\]|:\|\||:\|:|::|:\||\|:|\|\]|\|\||\|)|'
                   r'(?P<tup>\(3)|(?P<slur>[()])|'
                   r'(?P<note>(?P<acc>\^\^|\^|__|_|=)?(?P<step>[A-Ga-gz])(?P<oct>[\',]*)(?P<len>\d*(?:/+\d*)?))'
                   r'(?P<tie>-)?|(?P<broken>[<>]+)|(?P<sp>\s+)')


class Ev:
    """A note or rest. dur in quarter notes."""
    def __init__(self, step, octave, alter, dur, rest=False):
        self.step, self.octave, self.alter, self.dur, self.rest = step, octave, alter, dur, rest
        self.tie_start = self.tie_stop = False
        self.chord: str | None = None
        self.tuplet = False
        self.tuplet_pos = 0
        self.marks: list[str] = []
        self.lyrics: dict[int, tuple[str, str]] = {}  # verse -> (syllabic, text)
        self.extend: set[int] = set()


def parse_body(lines, fifths, mode, beats, beat_type, unit):
    """-> measures (lists of Ev), metas (one dict per measure: time, key, barlines, endings, marks),
    and the per-music-line event lists and w: lines for the words."""
    measures: list[list[Ev]] = [[]]
    metas: list[dict] = [{}]
    music_lines: list[list[Ev]] = []
    words: list[list[str]] = []
    base = key_alters(fifths)
    bar_acc: dict[tuple[str, int], int] = {}
    pending_chord = None
    pending_marks: list[str] = []
    pending_meta: dict = {}
    cur_time, cur_key = (beats, beat_type), (fifths, mode)
    tup_left = 0
    broken = None
    last_ev: Ev | None = None

    def close_bar(kind: str):
        nonlocal bar_acc, pending_marks
        target = metas[-1] if measures[-1] or len(metas) == 1 else metas[-2]
        if pending_marks:
            target.setdefault("end_marks", []).extend(pending_marks)
            pending_marks = []
        if kind in (":|", ":|]", ":||", "::", ":|:"):
            target["right"] = "backward"
        elif kind == "|]":
            target["right"] = "light-heavy"
        elif kind == "||":
            target["right"] = "light-light"
        if measures[-1]:
            measures.append([])
            metas.append(dict(pending_meta))
            pending_meta.clear()
        if kind in ("|:", "::", ":|:"):
            metas[-1]["left_repeat"] = True
        bar_acc = {}

    for raw in lines:
        if raw.startswith("w:"):
            if not music_lines:
                raise AbcError("w: before any music")
            words[-1].append(raw[2:])
            continue
        line = raw.split("%")[0].rstrip()
        if not line.strip():
            continue
        cur_line: list[Ev] = []
        music_lines.append(cur_line)
        words.append([])
        pos = 0
        while pos < len(line):
            m = TOKEN.match(line, pos)
            if not m:
                raise AbcError(f"cannot read {line[pos:pos + 12]!r}")
            pos = m.end()
            if m.group("chord") is not None:
                pending_chord = m.group("chord").strip()
            elif m.group("mark"):
                if m.group("mark") in MARKS:
                    pending_marks.append(MARKS[m.group("mark")])
            elif m.group("field"):
                f, val = m.group("field"), m.group("fval")
                change = {}
                if f == "M" and parse_meter(val) != cur_time:
                    cur_time = parse_meter(val)
                    change["time"] = cur_time
                elif f == "K" and key_fifths(val) != cur_key:
                    cur_key = key_fifths(val)
                    base = key_alters(cur_key[0])
                    change["key"] = cur_key
                elif f == "L":
                    unit = F(*map(int, val.split("/")))
                if f == "M":
                    change["m_written"] = True  # tidy_bars reads a short bar before it as another time
                (metas[-1] if not measures[-1] else pending_meta).update(change)
            elif m.group("ending"):
                metas[-1]["ending"] = m.group("ending")
            elif m.group("bar"):
                close_bar(m.group("bar"))
            elif m.group("tup"):
                tup_left = 3
            elif m.group("broken"):
                broken = m.group("broken")
            elif m.group("note"):
                step = m.group("step")
                dur = parse_length(m.group("len")) * unit * 4  # quarters
                if tup_left:
                    dur = dur * F(2, 3)
                if step == "z":
                    ev = Ev(None, None, 0, dur, rest=True)
                else:
                    octave = 4 if step.isupper() else 5
                    octave += m.group("oct").count("'") - m.group("oct").count(",")
                    letter = step.upper()
                    acc = m.group("acc")
                    if acc:
                        alter = {"^": 1, "^^": 2, "_": -1, "__": -2, "=": 0}[acc]
                        bar_acc[(letter, octave)] = alter
                    else:
                        alter = bar_acc.get((letter, octave), base.get(letter, 0))
                    ev = Ev(letter, octave, alter, dur)
                    if m.group("tie"):
                        ev.tie_start = True
                if tup_left:
                    ev.tuplet = True
                    ev.tuplet_pos = 3 - tup_left
                    tup_left -= 1
                prev = measures[-1][-1] if measures[-1] else None
                if broken and prev is not None:
                    k = len(broken)
                    frac = F(2 ** k - 1, 2 ** k)
                    total = prev.dur + ev.dur
                    long_, short = total / 2 * (1 + frac), total / 2 * (1 - frac)
                    if broken[0] == ">":
                        prev.dur, ev.dur = long_, short
                    else:
                        prev.dur, ev.dur = short, long_
                broken = None
                ev.chord, pending_chord = pending_chord, None
                ev.marks, pending_marks = pending_marks, []
                if last_ev is not None and last_ev.tie_start and not ev.rest:
                    ev.tie_stop = True
                last_ev = ev
                measures[-1].append(ev)
                cur_line.append(ev)
    if pending_marks:
        metas[-1 if measures[-1] else -2].setdefault("end_marks", []).extend(pending_marks)
    if not measures[-1]:
        measures.pop()
        metas.pop()
    if pending_chord:
        raise AbcError(f"chord {pending_chord!r} at the end with no note")
    # every measure knows its time and key
    t, k = (beats, beat_type), (fifths, mode)
    for evs, meta in zip(measures, metas):
        t = meta.get("time", t)
        k = meta.get("key", k)
        meta["beats"], meta["beat_type"] = t
        meta["fifths"], meta["mode"] = k
        if evs and ("segno" in evs[0].marks or "coda" in evs[0].marks):
            meta["mark"] = True
    tidy_bars(measures, metas)
    mark_endings(metas)
    # D.S./D.C. say where they stop, the way printed music does: al Fine, al Coda
    marks = {m for e in sum(measures, []) for m in e.marks} | {m for meta in metas for m in meta.get("end_marks", [])}
    tail = " al Fine" if "Fine" in marks else " al Coda" if "coda" in marks else ""
    lists = [x for evs, meta in zip(measures, metas) for x in [e.marks for e in evs] + [meta.get("end_marks", [])]]
    for x in lists:
        x[:] = [m + tail if m in ("D.S.", "D.C.") else m for m in x]
    # coda marks as text: the renderer turns a coda sign inside a repeat into "To Coda". With two,
    # the first is where to jump from; a single one marks the coda itself
    codas = [(x, k) for x in lists for k, m in enumerate(x) if m == "coda"]
    for idx, (x, k) in enumerate(codas):
        x[k] = "To ⊕" if len(codas) > 1 and idx == 0 else "⊕"
    return measures, metas, music_lines, words


def tidy_bars(measures, metas):
    """Short bars in the middle of a song. Two neighbours that add up to one bar are one bar split at
    a line break (a phrase end, then the next pickup): join them. A short bar left on its own is a
    bar in another time when the source writes a time change right after it (it sometimes writes
    only the change back): give it its own time, 2/4 or 3/4, and the old time again after it."""
    full = lambda i: F(metas[i]["beats"] * 4, metas[i]["beat_type"])  # noqa: E731
    length = lambda i: sum(e.dur for e in measures[i])  # noqa: E731
    structural = ("right", "ending_stop", "end_marks")
    i = 1
    while i < len(measures) - 1:
        if (length(i) < full(i) and length(i + 1) < full(i + 1) and length(i) + length(i + 1) == full(i)
                and not any(metas[i].get(k) for k in structural)
                and not any(metas[i + 1].get(k) for k in ("left_repeat", "ending", "time", "key", "mark"))):
            measures[i].extend(measures.pop(i + 1))
            nxt = metas.pop(i + 1)
            for k in ("right", "end_marks", "ending_stop"):
                if k in nxt:
                    metas[i][k] = nxt[k]
        i += 1
    for i in range(1, len(measures) - 1):
        q = length(i)
        if (q < full(i) and q.denominator == 1 and metas[i]["beat_type"] == 4
                and not any(metas[i].get(k) for k in ("right", "ending", "ending_stop", "left_repeat"))
                and metas[i + 1].get("m_written") and not any(metas[i + 1].get(k) for k in ("left_repeat", "ending"))):
            old = (metas[i]["beats"], metas[i]["beat_type"])
            metas[i]["time"] = (int(q), 4)
            metas[i]["beats"] = int(q)
            if "time" not in metas[i + 1]:
                metas[i + 1]["time"] = old


def mark_endings(metas):
    """Where each ending bracket stops: at its backward repeat, or (the last ending) after as many
    bars as the first ending took, cut short by a double bar or a new section."""
    first_len = 1
    for i, meta in enumerate(metas):
        if not meta.get("ending"):
            continue
        j = i
        while j < len(metas):
            if metas[j].get("right") == "backward":
                metas[j]["ending_stop"] = (meta["ending"], "stop")
                first_len = j - i + 1
                break
            if j > i and (metas[j].get("ending") or metas[j].get("left_repeat")):
                metas[j - 1]["ending_stop"] = (meta["ending"], "discontinue")
                break
            if metas[j].get("right") in ("light-light", "light-heavy") or j - i + 1 >= first_len:
                metas[j]["ending_stop"] = (meta["ending"], "discontinue")
                break
            j += 1


def syllables(text: str) -> list[str]:
    """Split a w: line into per-note tokens ('_' hold, '*' skip, a trailing '-' joins the next)."""
    toks = re.findall(r"[^\s\-_*~]+(?:~[^\s\-_*~]+)*-?|[_*]", text)
    return [t.replace("~", " ") for t in toks]


def assign_words(music_lines, words):
    """Returns the number of verses."""
    verses = 0
    for evs, wl in zip(music_lines, words):
        slots = [e for e in evs if not e.rest]
        for v, text in enumerate(wl, start=1):
            verses = max(verses, v)
            toks = syllables(text)
            if len(toks) > len(slots):
                raise AbcError(f"verse {v}: {len(toks)} words for {len(slots)} notes in a line")
            cont = False
            last = None
            for ev, tok in zip(slots, toks):
                if tok == "*":
                    cont = False
                    continue
                if tok == "_":
                    if last is not None:
                        last.extend.add(v)
                    continue
                hy = tok.endswith("-") and len(tok) > 1
                text_ = tok[:-1] if hy else tok
                syl = ("middle" if hy else "end") if cont else ("begin" if hy else "single")
                ev.lyrics[v] = (syl, text_)
                last = ev
                cont = hy
    return verses


def note_type(d: F):
    for length, name, dots in TYPES:
        if d == length:
            return name, dots
    return None


def split_parts(d: F) -> list[F]:
    """A length that has no single note value, as tied pieces (largest first)."""
    out = []
    for length in [F(4), F(3), F(2), F(3, 2), F(1), F(3, 4), F(1, 2), F(3, 8), F(1, 4), F(1, 8)]:
        while d >= length:
            out.append(length)
            d -= length
    if d:
        raise AbcError("unrepresentable length")
    return out


def chord_element(sym: str, ksteps_pref: int):
    m = re.fullmatch(r"([A-G])([#b]?)([^/]*)(?:/([A-G])([#b]?))?", sym)
    if not m:
        raise AbcError(f"chord {sym!r}")
    kind_txt = m.group(3)
    if kind_txt not in KINDS:
        raise AbcError(f"chord kind {kind_txt!r} in {sym!r}")
    h = etree.Element("harmony", {"print-frame": "no"})
    r = etree.SubElement(h, "root")
    etree.SubElement(r, "root-step").text = m.group(1)
    if m.group(2):
        etree.SubElement(r, "root-alter").text = "1" if m.group(2) == "#" else "-1"
    text = {"suspended-fourth": "sus4", "major": "", "minor": "m", "dominant": "7", "major-seventh": "maj7",
            "minor-seventh": "m7", "diminished": "dim", "augmented": "+", "half-diminished": "m7b5",
            "diminished-seventh": "dim7", "major-sixth": "6", "minor-sixth": "m6", "dominant-ninth": "9"}[KINDS[kind_txt]]
    etree.SubElement(h, "kind", {"text": text}).text = KINDS[kind_txt]
    if m.group(4):
        b = etree.SubElement(h, "bass")
        etree.SubElement(b, "bass-step").text = m.group(4)
        if m.group(5):
            etree.SubElement(b, "bass-alter").text = "1" if m.group(5) == "#" else "-1"
    etree.SubElement(h, "staff").text = "1"
    return h


PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
TONES = {"major": (0, 4, 7), "minor": (0, 3, 7), "dominant": (0, 4, 7, 10), "major-seventh": (0, 4, 7, 11),
         "minor-seventh": (0, 3, 7, 10), "suspended-fourth": (0, 5, 7), "diminished": (0, 3, 6),
         "augmented": (0, 4, 8), "half-diminished": (0, 3, 6, 10), "diminished-seventh": (0, 3, 6, 9),
         "major-sixth": (0, 4, 7, 9), "minor-sixth": (0, 3, 7, 9), "dominant-ninth": (0, 2, 4, 7, 10)}


def chord_tones(sym: str) -> set[int]:
    m = re.fullmatch(r"([A-G])([#b]?)([^/]*)(?:/([A-G])([#b]?))?", sym)
    r = (PC[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]) % 12
    return {(r + i) % 12 for i in TONES[KINDS[m.group(3)]]}


def clashes(measures, metas, pickup) -> list[str]:
    """Melody notes that start on a main beat, last at least a beat, and are not in the chord sounding."""
    out, cur = [], None
    for i, (evs, meta) in enumerate(zip(measures, metas)):
        beats, beat_type = meta["beats"], meta["beat_type"]
        bar_len = F(beats * 4, beat_type)
        beat = F(4, beat_type) * (3 if beat_type == 8 and beats % 3 == 0 else 1)
        t = bar_len - sum(e.dur for e in evs) if (pickup and i == 0) else F(0)
        for e in evs:
            if e.chord:
                cur = e.chord
            if (not e.rest and not e.tie_stop and cur and t % beat == 0 and e.dur >= beat
                    and (PC[e.step] + e.alter) % 12 not in chord_tones(cur)):
                out.append(f"bar {i + (0 if pickup else 1)} beat {t / beat + 1}: {e.step}{'#' if e.alter > 0 else 'b' if e.alter < 0 else ''} over {cur}")
            t += e.dur
    return out


def direction(me, mark: str):
    d = etree.SubElement(me, "direction", placement="above")
    dt = etree.SubElement(d, "direction-type")
    if mark in ("segno", "coda"):
        etree.SubElement(dt, mark)
        if mark == "segno":  # a coda with <sound coda> is drawn as "To Coda"
            etree.SubElement(d, "sound", {mark: mark})
    else:
        etree.SubElement(dt, "words", {"font-weight": "bold"}).text = mark


def barline(me, location: str, style: str | None, ending=None, repeat: str | None = None):
    bl = etree.SubElement(me, "barline", location=location)
    if style:
        etree.SubElement(bl, "bar-style").text = style
    if ending:
        num, typ = ending
        e = etree.SubElement(bl, "ending", number=num.replace(",", ", "), type=typ)
        if typ == "start":
            e.text = num.replace(",", ". ") + "."
    if repeat:
        etree.SubElement(bl, "repeat", direction=repeat)


def build(src: str, number: int) -> tuple[etree._Element, dict]:
    head, body = {}, []
    for raw in open(src, encoding="utf-8-sig"):
        raw = raw.rstrip("\n")
        if raw.startswith("%"):
            continue
        m = re.match(r"^([A-Za-z]):(.*)$", raw)
        if m and m.group(1) in "NPZSOBDHRIC":
            continue
        if m and m.group(1) in "XTKML" and not body:
            head[m.group(1)] = m.group(2).strip()
        else:
            body.append(raw)
    fifths, mode = key_fifths(head.get("K", "C"))
    beats, beat_type = parse_meter(head.get("M", "4/4"))
    unit = F(*map(int, head.get("L", "1/8").split("/")))
    measures, metas, music_lines, words = parse_body(body, fifths, mode, beats, beat_type, unit)
    verses = assign_words(music_lines, words)
    problems, notes = [], []
    lens = [sum(e.dur for e in ms) for ms in measures]
    bar_lens = [F(m["beats"] * 4, m["beat_type"]) for m in metas]
    pickup = lens[0] < bar_lens[0]
    for i, (L, full) in enumerate(zip(lens, bar_lens)):
        if L > full:
            problems.append(f"bar {i + (0 if pickup else 1)}: {L} quarters, more than {full}")
        elif L < full and not (i == 0 or i == len(lens) - 1):
            notes.append(f"bar {i + (0 if pickup else 1)}: short bar ({L} of {full} quarters)")
    given = sum(1 for e in sum(measures, []) if e.chord)
    made = 0 if given else harmonize(measures, metas, pickup)

    root = etree.Element("score-partwise", version="4.0")
    w = etree.SubElement(root, "work")
    etree.SubElement(w, "work-number").text = str(number)
    etree.SubElement(w, "work-title").text = head.get("T", "")
    ident = etree.SubElement(root, "identification")
    enc = etree.SubElement(ident, "encoding")
    etree.SubElement(enc, "software").text = "hymnal tools/leadsheet.py"
    etree.SubElement(root, "defaults")
    pl = etree.SubElement(root, "part-list")
    sp = etree.SubElement(pl, "score-part", id="P1")
    etree.SubElement(sp, "part-name", {"print-object": "no"}).text = "Melody"
    part = etree.SubElement(root, "part", id="P1")
    for i, (evs, meta) in enumerate(zip(measures, metas)):
        num = i if pickup else i + 1
        me = etree.SubElement(part, "measure", number=str(num))
        if lens[i] < bar_lens[i]:
            me.set("implicit", "yes")
        if i == 0 or "time" in meta or "key" in meta:
            a = etree.SubElement(me, "attributes")
            if i == 0:
                etree.SubElement(a, "divisions").text = str(DIV)
            if i == 0 or "key" in meta:
                k = etree.SubElement(a, "key")
                etree.SubElement(k, "fifths").text = str(meta["fifths"])
                etree.SubElement(k, "mode").text = meta["mode"]
            if i == 0 or "time" in meta:
                t = etree.SubElement(a, "time")
                etree.SubElement(t, "beats").text = str(meta["beats"])
                etree.SubElement(t, "beat-type").text = str(meta["beat_type"])
            if i == 0:
                c = etree.SubElement(a, "clef")
                etree.SubElement(c, "sign").text = "G"
                etree.SubElement(c, "line").text = "2"
        if meta.get("left_repeat") or meta.get("ending"):
            barline(me, "left", "heavy-light" if meta.get("left_repeat") else None,
                    (meta["ending"], "start") if meta.get("ending") else None,
                    "forward" if meta.get("left_repeat") else None)
        for ev in evs:
            for mark in ev.marks:
                direction(me, mark)
            if ev.chord:
                me.append(chord_element(ev.chord, meta["fifths"]))
            shown = ev.dur * F(3, 2) if ev.tuplet else ev.dur
            nt = note_type(shown)
            pieces = [ev.dur] if nt else split_parts(ev.dur)
            for pi, d in enumerate(pieces):
                n = etree.SubElement(me, "note")
                if ev.rest:
                    etree.SubElement(n, "rest")
                else:
                    p = etree.SubElement(n, "pitch")
                    etree.SubElement(p, "step").text = ev.step
                    if ev.alter:
                        etree.SubElement(p, "alter").text = str(ev.alter)
                    etree.SubElement(p, "octave").text = str(ev.octave)
                etree.SubElement(n, "duration").text = str(int(d * DIV))
                tie_stop = (ev.tie_stop if pi == 0 else True) and not ev.rest
                tie_start = (ev.tie_start if pi == len(pieces) - 1 else True) and not ev.rest
                if tie_stop:
                    etree.SubElement(n, "tie", type="stop")
                if tie_start:
                    etree.SubElement(n, "tie", type="start")
                etree.SubElement(n, "voice").text = "1"
                name, dots = note_type(d * F(3, 2) if ev.tuplet else d)
                etree.SubElement(n, "type").text = name
                for _ in range(dots):
                    etree.SubElement(n, "dot")
                if ev.tuplet:
                    tm = etree.SubElement(n, "time-modification")
                    etree.SubElement(tm, "actual-notes").text = "3"
                    etree.SubElement(tm, "normal-notes").text = "2"
                etree.SubElement(n, "staff").text = "1"
                tup = ev.tuplet and (ev.tuplet_pos in (0, 2))
                if tie_stop or tie_start or tup:
                    no = etree.SubElement(n, "notations")
                    if tie_stop:
                        etree.SubElement(no, "tied", type="stop")
                    if tie_start:
                        etree.SubElement(no, "tied", type="start")
                    if tup:
                        etree.SubElement(no, "tuplet", type="start" if ev.tuplet_pos == 0 else "stop", bracket="no")
                if pi == 0:
                    for v, (syl, text) in sorted(ev.lyrics.items()):
                        ly = etree.SubElement(n, "lyric", number=str(2 * v - 1))
                        etree.SubElement(ly, "syllabic").text = syl
                        t = etree.SubElement(ly, "text")
                        t.text = text
                        # one language for the app's lyric modes: a praise song's words are all its own,
                        # even an English or Hebrew line, and verse 1 must stay above verse 2
                        t.set("{http://www.w3.org/XML/1998/namespace}lang", "ko")
                        if v in ev.extend:
                            etree.SubElement(ly, "extend")
        # marks at the end of a bar (D.S. at the last barline) go over its last note: the renderer
        # draws nothing for a direction after the last note
        last_note = me.findall("note")[-1] if me.find("note") is not None else None
        for mark in meta.get("end_marks", []):
            direction(me, mark)
            if last_note is not None:
                last_note.addprevious(me[-1])
        right = meta.get("right")
        if i == len(measures) - 1 and right is None:
            right = "light-heavy"
        if right or meta.get("ending_stop"):
            style = {"backward": "light-heavy", "light-heavy": "light-heavy", "light-light": "light-light"}.get(right)
            barline(me, "right", style, meta.get("ending_stop"), "backward" if right == "backward" else None)
    # verse numbers on each verse's first syllable, the way the hymns are written
    if verses > 1:
        seen = set()
        for ly in root.iter("lyric"):
            v = (int(ly.get("number")) + 1) // 2
            if v not in seen:
                seen.add(v)
                ly.find("text").text = f"{v}.{ly.find('text').text}"
    info = {"title": head.get("T", ""), "fifths": fifths, "mode": mode, "meter": f"{beats}/{beat_type}",
            "bars": len(measures), "verses": verses, "problems": problems, "notes": notes,
            "chords": given or made, "made": bool(made),
            "clashes": clashes(measures, metas, pickup)}
    if not info["chords"]:
        problems.append("no chord letters")
    return root, info


def write(nn: int) -> dict:
    d = os.path.join(ROOT, "data/praise", f"{nn:02d}")
    root, info = build(os.path.join(d, "song.abc"), 1000 + nn)
    if not info["problems"]:
        etree.ElementTree(root).write(os.path.join(d, "score.musicxml"), pretty_print=True,
                                      xml_declaration=True, encoding="UTF-8")
    return info


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    if args == ["all"]:
        args = sorted(os.path.basename(d) for d in glob.glob(os.path.join(ROOT, "data/praise/[0-9]*")))
    verbose = "-v" in args
    bad = 0
    for a in (x for x in args if x != "-v"):
        try:
            info = write(int(a))
        except AbcError as e:
            print(f"{a}: ERROR {e}")
            bad += 1
            continue
        status = "OK" if not info["problems"] else "PROBLEMS"
        print(f"{a}: {status} bars={info['bars']} verses={info['verses']} chords={info['chords']}"
              f"{' (made by rule)' if info['made'] else ''} clashes={len(info['clashes'])}")
        for p in info["problems"]:
            print("   ", p)
        if verbose:
            for x in info["notes"] + [f"clash: {c}" for c in info["clashes"]]:
                print("   ", x)
        bad += bool(info["problems"])
    sys.exit(1 if bad else 0)
