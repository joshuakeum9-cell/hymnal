"""Convert the MuseScore 3.02 hymn files (깔끔이 CCM set, CC BY 4.0) into canonical MusicXML 4.0.

One output part with N staves (normally 2: treble + bass). Voices are numbered
staff*4 + voice + 1, the same convention MuseScore's own exporter uses.
Korean lyrics keep MuseScore's verse index: verse k (MuseScore <no> = k-1)
becomes lyric number 2k-1, leaving the even numbers free for English.

Usage:
  python tools/convert_mscz.py work/ccm4u/mscz data/hymns          # all files
  python tools/convert_mscz.py work/ccm4u/mscz data/hymns 405 300  # selected hymns
"""
from __future__ import annotations

import os
import re
import sys
import zipfile
import hashlib
import unicodedata
from fractions import Fraction as F

from lxml import etree

DIVISIONS = 96  # per quarter note: covers 64ths, dotted 32nds and triplets

BASE = {
    "long": F(16), "breve": F(8), "whole": F(4), "half": F(2), "quarter": F(1),
    "eighth": F(1, 2), "16th": F(1, 4), "32nd": F(1, 8), "64th": F(1, 16), "128th": F(1, 32),
}
ACC = {
    "accidentalFlat": "flat", "accidentalSharp": "sharp", "accidentalNatural": "natural",
    "accidentalDoubleSharp": "double-sharp", "accidentalDoubleFlat": "flat-flat",
    "accidentalSharpSharp": "sharp-sharp",
}
FIFTHS_STEPS = "FCGDAEB"

# Source corrections, each recorded in the hymn's source.json "changes" list.
KEY_OVERRIDES = {
    # treble has no key signature and never uses B-flat; bass says one flat. A minor per the
    # independent key table (praisenworship.biblia66.com/15) and the notes themselves.
    145: (0, "minor"),
}
# (hymn, verse, wrong syllables, right syllables), typos found by pozafly/hymn-transpose's audit
LYRIC_FIXES = [
    (220, 1, "복을받아", "본을받아"),
    (519, 4, "두르려", "두드려"),
]


def tpc_to_step_alter(tpc: int) -> tuple[str, int]:
    step = FIFTHS_STEPS[(tpc + 1) % 7]
    alter = (tpc + 1) // 7 - 2
    return step, alter


def pitch_xml(midi: int, tpc: int) -> tuple[str, int, int]:
    step, alter = tpc_to_step_alter(tpc)
    natural = midi - alter
    octave = natural // 12 - 1
    return step, alter, octave


def frac_of(text: str | None) -> F:
    if not text:
        return F(0)
    return F(text.strip())


def read_mscx(path: str) -> etree._Element:
    z = zipfile.ZipFile(path)
    name = [n for n in z.namelist() if n.endswith(".mscx")][0]
    return etree.fromstring(z.read(name))


def text_of(el) -> str:
    """Plain text of a MuseScore <text> element, dropping <font>/<sym> markup."""
    if el is None:
        return ""
    s = etree.tostring(el, encoding="unicode", method="text")
    return unicodedata.normalize("NFC", s).strip()


class Event:
    """One chord, rest, or gap in one voice stream."""

    __slots__ = ("kind", "start", "dur", "notes", "dtype", "dots", "tuplet", "grace", "lyrics",
                 "stem", "slur_start", "slur_stop", "fermata", "tuplet_start", "tuplet_stop",
                 "visible", "measure_rest")

    def __init__(self, kind: str, start: F, dur: F):
        self.kind = kind
        self.start = start
        self.dur = dur
        self.notes: list[dict] = []
        self.dtype = None
        self.dots = 0
        self.tuplet = None  # (actual, normal)
        self.grace = None
        self.lyrics: list[tuple[int, str]] = []
        self.stem = None
        self.slur_start = 0
        self.slur_stop = 0
        self.fermata = False
        self.tuplet_start = False
        self.tuplet_stop = False
        self.visible = True
        self.measure_rest = False


class Measure:
    def __init__(self, idx: int):
        self.idx = idx
        self.length = None  # actual length in quarters
        self.nominal = None
        self.streams: dict[tuple[int, int], list[Event]] = {}
        self.key = None  # (fifths, mode) change at this measure
        self.time = None  # (n, d) change at this measure
        self.time_symbol = None
        self.clefs: dict[int, str] = {}
        self.start_repeat = False
        self.end_repeat = None
        self.barline = None
        self.words: list[str] = []
        self.tempo = None
        self.ending_start = None  # (number, text)
        self.ending_stop = None  # (number, type)


def parse_score(root) -> dict:
    score = root.find("Score")
    meta = {"title": "", "composer": "", "lyricist": "", "subtitle": ""}
    staves = score.findall("Staff")
    n_staves = len(staves)
    # staves of parts wrongly set up as transposing instruments (112, 451): staff -> semitones
    respell: dict[int, int] = {}
    staff_ids = [st.get("id") for st in staves]
    for part in score.findall("Part"):
        chrom = int(part.findtext("Instrument/transposeChromatic") or 0)
        if chrom:
            for st in part.findall("Staff"):
                if st.get("id") in staff_ids:
                    respell[staff_ids.index(st.get("id"))] = chrom
    measures: list[Measure] = []
    volta_spans = []  # (staff0 measure idx, n measures, endings, text)

    cur_time = (4, 4)
    for s_idx, staff in enumerate(staves):
        m_i = 0
        for child in staff:
            if child.tag == "VBox" and s_idx == 0:
                for t in child.findall("Text"):
                    style = (t.findtext("style") or "").lower()
                    val = text_of(t.find("text"))
                    if style in meta:
                        meta[style] = val
                continue
            if child.tag != "Measure":
                continue
            if m_i >= len(measures):
                measures.append(Measure(m_i))
            M = measures[m_i]
            if child.get("len"):
                M.length = F(child.get("len")) * 4  # stored in whole notes
            for mc in child:
                if mc.tag == "startRepeat":
                    M.start_repeat = True
                elif mc.tag == "endRepeat":
                    M.end_repeat = int(mc.text or 2)
                elif mc.tag in ("Jump", "Marker") and s_idx == 0:
                    label = text_of(mc.find("text")) or (mc.findtext("label") or "")
                    if mc.tag == "Marker" and not text_of(mc.find("text")):
                        label = {"fine": "Fine", "segno": "𝄋", "coda": "𝄌"}.get(label.lower(), label)
                    if label:
                        M.words.append(label)
            voice_elems = child.findall("voice")
            for v_idx, voice in enumerate(voice_elems):
                parse_voice(voice, M, s_idx, v_idx, volta_spans, m_i)
            m_i += 1

    # time signature bookkeeping + measure lengths
    if measures and measures[0].time is None:
        measures[0].time = (4, 4)  # MuseScore's implicit default (hymns 133, 230)
    for M in measures:
        if M.time:
            cur_time = M.time
        M.nominal = F(cur_time[0] * 4, cur_time[1])
        if M.length is None:
            M.length = M.nominal

    for (m_idx, n_meas, endings, label) in volta_spans:
        if m_idx < len(measures):
            measures[m_idx].ending_start = (endings, label)
            last = min(m_idx + max(n_meas, 1) - 1, len(measures) - 1)
            measures[last].ending_stop = (endings, "stop")

    return {"meta": meta, "measures": measures, "n_staves": n_staves, "respell": respell}


def parse_voice(voice, M: Measure, s_idx: int, v_idx: int, volta_spans, m_i: int) -> None:
    tick = F(0)
    sub = 0  # sub-voice bumps when the cursor jumps backwards (hymn 133)
    stream_key = (s_idx, v_idx)
    stream = M.streams.setdefault(stream_key, [])
    tuplet = None
    pending_slur_start = 0
    pending_slur_stop = 0
    pending_fermata = False
    tuplet_first = False
    last_event = None

    for el in voice:
        tag = el.tag
        if tag == "location":
            delta = frac_of(el.findtext("fractions")) * 4
            new_tick = tick + delta
            if delta < 0:
                sub += 1
                stream_key = (s_idx, v_idx + 2 * sub)
                stream = M.streams.setdefault(stream_key, [])
                if new_tick > 0:
                    stream.append(Event("gap", F(0), new_tick))
            elif delta > 0:
                stream.append(Event("gap", tick, delta))
            tick = new_tick
        elif tag == "KeySig" and s_idx == 0:
            fifths = int(el.findtext("accidental") or el.findtext("concertKey") or 0)
            M.key = (fifths, el.findtext("mode") or "major")
        elif tag == "TimeSig" and s_idx == 0:
            M.time = (int(el.findtext("sigN")), int(el.findtext("sigD")))
            M.time_symbol = {"1": "common", "2": "cut"}.get(el.findtext("subtype") or "")
        elif tag == "Clef":
            M.clefs[s_idx] = el.findtext("concertClefType") or "G"
        elif tag == "Tempo" and s_idx == 0 and M.tempo is None:
            try:
                M.tempo = round(float(el.findtext("tempo")) * 60)
            except (TypeError, ValueError):
                pass
        elif tag == "StaffText":
            txt = text_of(el.find("text"))
            if txt:
                M.words.append(txt)
        elif tag == "Tuplet":
            tuplet = (int(el.findtext("actualNotes")), int(el.findtext("normalNotes")))
            tuplet_first = True
        elif tag == "endTuplet":
            if last_event is not None and last_event.tuplet:
                last_event.tuplet_stop = True
            tuplet = None
        elif tag == "Fermata":
            pending_fermata = True
        elif tag == "Spanner":
            typ = el.get("type")
            if typ == "Slur":
                if el.find("next") is not None:
                    pending_slur_start += 1
                if el.find("prev") is not None:
                    pending_slur_stop += 1
            elif typ == "Volta" and el.find("Volta") is not None and s_idx == 0:
                vol = el.find("Volta")
                endings = (vol.findtext("endings") or "1").replace(" ", "")
                label = text_of(vol.find("beginText")) or endings + "."
                n_meas = int(el.findtext("next/location/measures") or 1)
                volta_spans.append((m_i, n_meas, endings, label))
        elif tag in ("Chord", "Rest"):
            dtype = el.findtext("durationType")
            dots = int(el.findtext("dots") or 0)
            visible = el.findtext("visible") != "0"
            grace = None
            for g in ("appoggiatura", "acciaccatura", "grace4", "grace8", "grace16", "grace32",
                      "grace8after", "grace16after", "grace32after"):
                if el.find(g) is not None:
                    grace = g
            if dtype == "measure":
                dur = frac_of(el.findtext("duration")) * 4
            else:
                base = BASE.get(dtype, F(1))
                dur = base * (2 - F(1, 2 ** dots))
                if tuplet:
                    dur = dur * F(tuplet[1], tuplet[0])
            if grace:
                dur = F(0)
            ev = Event("chord" if tag == "Chord" else "rest", tick, dur)
            ev.dtype = dtype
            ev.dots = dots
            ev.visible = visible
            ev.measure_rest = dtype == "measure"
            ev.grace = grace
            if tuplet and not grace:
                ev.tuplet = tuplet
                if tuplet_first:
                    ev.tuplet_start = True
                    tuplet_first = False
            ev.stem = (el.findtext("StemDirection") or None)
            if tag == "Chord":
                for n in el.findall("Note"):
                    tie_start = tie_stop = False
                    for sp in n.findall("Spanner"):
                        if sp.get("type") == "Tie":
                            if sp.find("next") is not None:
                                tie_start = True
                            if sp.find("prev") is not None:
                                tie_stop = True
                    acc = n.find("Accidental")
                    ev.notes.append({
                        "pitch": int(n.findtext("pitch")),
                        "tpc": int(n.findtext("tpc")),
                        "tpc2": int(n.findtext("tpc2")) if n.findtext("tpc2") else None,
                        "tie_start": tie_start,
                        "tie_stop": tie_stop,
                        "acc": ACC.get(acc.findtext("subtype")) if acc is not None else None,
                        "visible": n.findtext("visible") != "0",
                    })
                for ly in el.findall("Lyrics"):
                    no = int(ly.findtext("no") or 0)
                    txt = text_of(ly.find("text"))
                    if txt:
                        ev.lyrics.append((no, txt))
                ev.notes.sort(key=lambda d: d["pitch"])  # low to high
            if pending_slur_start:
                ev.slur_start = pending_slur_start
                pending_slur_start = 0
            if pending_slur_stop:
                ev.slur_stop = pending_slur_stop
                pending_slur_stop = 0
            if pending_fermata:
                ev.fermata = True
                pending_fermata = False
            stream.append(ev)
            last_event = ev
            tick += dur


CLEF = {
    "G": ("G", 2, 0), "G8vb": ("G", 2, -1), "G8va": ("G", 2, 1), "F": ("F", 4, 0),
    "F8vb": ("F", 4, -1), "C3": ("C", 3, 0), "C4": ("C", 4, 0),
}


def dur_units(q: F) -> int:
    v = q * DIVISIONS
    if v.denominator != 1:
        raise ValueError(f"duration {q} not representable at {DIVISIONS} divisions")
    return int(v)


def sub(parent, tag, text=None, **attrs):
    el = etree.SubElement(parent, tag, {k.replace("_", "-"): str(v) for k, v in attrs.items()})
    if text is not None:
        el.text = str(text)
    return el


def build_musicxml(parsed: dict, number: int, title_ko: str) -> etree._Element:
    meta = parsed["meta"]
    measures: list[Measure] = parsed["measures"]
    n_staves = parsed["n_staves"]

    root = etree.Element("score-partwise", version="4.0")
    work = sub(root, "work")
    sub(work, "work-number", str(number))
    sub(work, "work-title", title_ko)
    ident = sub(root, "identification")
    if meta["composer"]:
        sub(ident, "creator", meta["composer"], type="composer")
    if meta["lyricist"]:
        sub(ident, "creator", meta["lyricist"], type="lyricist")
    sub(ident, "rights", "Transcription: 깔끔이 CCM (ccm4u.tistory.com), CC BY 4.0. Converted and edited for this project.")
    enc = sub(ident, "encoding")
    sub(enc, "software", "hymnal tools/convert_mscz.py")
    sub(root, "defaults")
    # lyric-language declarations are added by build_data.py once English exists
    pl = sub(root, "part-list")
    sp = sub(pl, "score-part", id="P1")
    sub(sp, "part-name", "SATB", print_object="no")
    part = sub(root, "part", id="P1")

    cur_key = None
    pickup = measures and measures[0].length < measures[0].nominal
    open_slurs: dict[int, list[int]] = {}

    for M in measures:
        num = M.idx if pickup else M.idx + 1
        mattrs = {"number": str(num)}
        if M.length < M.nominal and (M.idx == 0 or M.idx == len(measures) - 1):
            mattrs["implicit"] = "yes" if M.idx == 0 else "no"
        mx = sub(part, "measure", **mattrs)

        if M.start_repeat or M.ending_start:
            bl = sub(mx, "barline", location="left")
            if M.start_repeat:
                sub(bl, "bar-style", "heavy-light")
            if M.ending_start:
                nums, label = M.ending_start
                sub(bl, "ending", label, number=nums, type="start")
            if M.start_repeat:
                sub(bl, "repeat", direction="forward")

        need_attr = M.idx == 0 or M.key or M.time or M.clefs
        if need_attr:
            at = sub(mx, "attributes")
            if M.idx == 0:
                sub(at, "divisions", DIVISIONS)
            if M.key or M.idx == 0:
                fifths, mode = M.key or (0, "major")
                if (fifths, mode) != cur_key:
                    k = sub(at, "key")
                    sub(k, "fifths", fifths)
                    sub(k, "mode", mode)
                    cur_key = (fifths, mode)
            if M.time:
                t = sub(at, "time", **({"symbol": M.time_symbol} if M.time_symbol else {}))
                sub(t, "beats", M.time[0])
                sub(t, "beat-type", M.time[1])
            if M.idx == 0:
                sub(at, "staves", n_staves)
            for s in sorted(M.clefs):
                sign, line, oct_ = CLEF.get(M.clefs[s], ("G", 2, 0))
                c = sub(at, "clef", number=s + 1)
                sub(c, "sign", sign)
                sub(c, "line", line)
                if oct_:
                    sub(c, "clef-octave-change", oct_)

        if M.idx == 0 and M.tempo:
            sub(mx, "sound", tempo=M.tempo)  # kept for playback, never drawn
        for w in M.words:
            d = sub(mx, "direction", placement="above")
            dt = sub(d, "direction-type")
            sub(dt, "words", w, font_style="italic")
            sub(d, "staff", 1)

        first_stream = True
        for (s_idx, v_idx) in sorted(M.streams):
            events = [e for e in M.streams[(s_idx, v_idx)]]
            if not events:
                continue
            voice_id = s_idx * 4 + v_idx + 1
            if not first_stream:
                sub(sub(mx, "backup"), "duration", dur_units(M.length))
            first_stream = False
            pos = F(0)
            for ev in events:
                if ev.start > pos and ev.kind != "gap":
                    sub(sub(mx, "forward"), "duration", dur_units(ev.start - pos))
                    pos = ev.start
                if ev.kind == "gap":
                    if ev.dur > 0:
                        sub(sub(mx, "forward"), "duration", dur_units(ev.dur))
                        pos = ev.start + ev.dur
                    continue
                write_event(mx, ev, voice_id, s_idx, open_slurs)
                pos = ev.start + ev.dur
            if pos < M.length:
                sub(sub(mx, "forward"), "duration", dur_units(M.length - pos))

        if M.end_repeat or M.ending_stop or M.barline or M.idx == len(measures) - 1:
            bl = sub(mx, "barline", location="right")
            if M.end_repeat or M.idx == len(measures) - 1:
                sub(bl, "bar-style", "light-heavy")
            if M.ending_stop:
                sub(bl, "ending", number=M.ending_stop[0], type="stop")
            if M.end_repeat:
                sub(bl, "repeat", direction="backward")
    return root


TYPE_NAME = {"eighth": "eighth", "16th": "16th", "32nd": "32nd", "64th": "64th", "128th": "128th",
             "quarter": "quarter", "half": "half", "whole": "whole", "breve": "breve", "long": "long"}


def write_event(mx, ev: Event, voice_id: int, s_idx: int, open_slurs) -> None:
    stem = ev.stem or ("up" if voice_id % 2 == 1 else "down")
    if ev.kind == "rest":
        n = sub(mx, "note", **({} if ev.visible else {"print_object": "no"}))
        sub(n, "rest", **({"measure": "yes"} if ev.measure_rest else {}))
        sub(n, "duration", dur_units(ev.dur))
        sub(n, "voice", voice_id)
        if not ev.measure_rest and ev.dtype in TYPE_NAME:
            sub(n, "type", TYPE_NAME[ev.dtype])
            for _ in range(ev.dots):
                sub(n, "dot")
        if ev.tuplet:
            tm = sub(n, "time-modification")
            sub(tm, "actual-notes", ev.tuplet[0])
            sub(tm, "normal-notes", ev.tuplet[1])
        sub(n, "staff", s_idx + 1)
        nots = []
        if ev.fermata:
            nots.append(("fermata", {"type": "upright"}))
        if ev.tuplet_start:
            nots.append(("tuplet", {"type": "start", "bracket": "no"}))
        if ev.tuplet_stop:
            nots.append(("tuplet", {"type": "stop"}))
        if nots:
            nt = sub(n, "notations")
            for tag, a in nots:
                sub(nt, tag, **a)
        return

    # chord: highest note first so the lyric sits on the melody pitch
    notes = sorted(ev.notes, key=lambda d: -d["pitch"])
    for i, nd in enumerate(notes):
        n = sub(mx, "note", **({} if nd["visible"] and ev.visible else {"print_object": "no"}))
        if ev.grace:
            sub(n, "grace", **({"slash": "yes"} if ev.grace == "acciaccatura" else {}))
        if i > 0:
            sub(n, "chord")
        p = sub(n, "pitch")
        step, alter, octave = pitch_xml(nd["pitch"], nd["tpc"])
        sub(p, "step", step)
        if alter:
            sub(p, "alter", alter)
        sub(p, "octave", octave)
        if not ev.grace:
            sub(n, "duration", dur_units(ev.dur))
        if nd["tie_stop"]:
            sub(n, "tie", type="stop")
        if nd["tie_start"]:
            sub(n, "tie", type="start")
        sub(n, "voice", voice_id)
        tname = TYPE_NAME.get(ev.dtype, "quarter")
        if ev.grace in ("grace16", "grace16after"):
            tname = "16th"
        elif ev.grace in ("grace32", "grace32after"):
            tname = "32nd"
        elif ev.grace in ("appoggiatura", "acciaccatura", "grace8", "grace8after"):
            tname = "eighth"
        elif ev.grace == "grace4":
            tname = "quarter"
        sub(n, "type", tname)
        for _ in range(ev.dots):
            sub(n, "dot")
        if nd["acc"]:
            sub(n, "accidental", nd["acc"])
        if ev.tuplet:
            tm = sub(n, "time-modification")
            sub(tm, "actual-notes", ev.tuplet[0])
            sub(tm, "normal-notes", ev.tuplet[1])
        sub(n, "stem", stem)
        sub(n, "staff", s_idx + 1)
        nots = []
        if nd["tie_stop"]:
            nots.append(("tied", {"type": "stop"}))
        if nd["tie_start"]:
            nots.append(("tied", {"type": "start"}))
        if i == 0:
            stack = open_slurs.setdefault(voice_id, [])
            for _ in range(ev.slur_stop):
                if stack:
                    nots.append(("slur", {"type": "stop", "number": stack.pop()}))
            for _ in range(ev.slur_start):
                num = 1
                while num in stack:
                    num += 1
                stack.append(num)
                nots.append(("slur", {"type": "start", "number": num}))
            if ev.fermata:
                nots.append(("fermata", {"type": "upright"}))
            if ev.tuplet_start:
                nots.append(("tuplet", {"type": "start", "bracket": "no"}))
            if ev.tuplet_stop:
                nots.append(("tuplet", {"type": "stop"}))
        if nots:
            nt = sub(n, "notations")
            for tag, a in nots:
                sub(nt, tag, **a)
        if i == 0:
            for no, txt in sorted(ev.lyrics):
                ly = sub(n, "lyric", number=2 * no + 1)
                sub(ly, "syllabic", "single")
                t = sub(ly, "text", txt)
                t.set("{http://www.w3.org/XML/1998/namespace}lang", "ko")


def hymn_number(filename: str) -> int:
    return int(re.match(r"(\d+)", os.path.basename(filename)).group(1))


def title_from_filename(filename: str) -> str:
    base = unicodedata.normalize("NFC", os.path.splitext(os.path.basename(filename))[0])
    return re.sub(r"^\d+장\s*", "", base).strip()


def serialize(root) -> bytes:
    etree.indent(root, space=" ")
    body = etree.tostring(root, encoding="UTF-8", xml_declaration=False, pretty_print=True)
    head = (b'<?xml version="1.0" encoding="UTF-8"?>\n'
            b'<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
            b'"http://www.musicxml.org/dtds/partwise.dtd">\n')
    return head + body


def convert_file(path: str) -> tuple[int, bytes, dict]:
    number = hymn_number(path)
    root = read_mscx(path)
    parsed = parse_score(root)
    changes = apply_fixes(number, parsed)
    title = title_from_filename(path)
    xml = build_musicxml(parsed, number, title)
    info = dict(parsed["meta"])
    info["source_sha256"] = hashlib.sha256(open(path, "rb").read()).hexdigest()
    info["source_file"] = unicodedata.normalize("NFC", os.path.basename(path))
    info["title_from_file"] = title
    info["changes"] = changes
    return number, serialize(xml), info


def apply_fixes(number: int, parsed: dict) -> list[str]:
    changes = []
    measures = parsed["measures"]
    if parsed.get("respell") and measures:
        # These parts are set up as transposing instruments by mistake, so the stored concert
        # pitches sit a minor third away from the printed hymn (the key signature is the written
        # key). Use the written pitch and its spelling (tpc2), which is what the hymnal prints.
        fixed = 0
        for M in measures:
            for (s_idx, _v), events in M.streams.items():
                chrom = parsed["respell"].get(s_idx)
                if not chrom:
                    continue
                for ev in events:
                    for nd in ev.notes:
                        nd["pitch"] -= chrom
                        if nd.get("tpc2") is not None:
                            nd["tpc"] = nd["tpc2"]
                        nd["acc"] = None
                        fixed += 1
                    ev.notes.sort(key=lambda d: d["pitch"])
        changes.append(f"staff transposition removed on staves {sorted(parsed['respell'])}: {fixed} notes moved to the written pitch")
    if number in KEY_OVERRIDES and measures:
        old = measures[0].key
        measures[0].key = KEY_OVERRIDES[number]
        changes.append(f"key signature {old} -> {KEY_OVERRIDES[number]}")
    for (hymn, verse, wrong, right) in LYRIC_FIXES:
        if hymn != number:
            continue
        seq = []  # (event, index in ev.lyrics)
        for M in measures:
            evs = [e for e in M.streams.get((0, 0), []) if e.kind == "chord"]
            for e in evs:
                for i, (no, txt) in enumerate(e.lyrics):
                    if no == verse - 1:
                        seq.append((e, i))
        syl = [e.lyrics[i][1] for e, i in seq]
        joined = "".join(re.sub(r"^[0-9]+[.]", "", t) for t in syl)
        pos = joined.find(wrong)
        if pos < 0:
            changes.append(f"lyric fix NOT applied (pattern missing): verse {verse} {wrong}")
            continue
        # map character offset to syllable index (one Hangul syllable per note)
        offs = []
        acc = 0
        for t in syl:
            offs.append(acc)
            acc += len(re.sub(r"^[0-9]+[.]", "", t))
        for k, (w, r) in enumerate(zip(wrong, right)):
            if w == r:
                continue
            idx = offs.index(pos + k)
            e, i = seq[idx]
            no, txt = e.lyrics[i]
            e.lyrics[i] = (no, txt.replace(w, r))
        changes.append(f"lyric verse {verse}: {wrong} -> {right}")
    return changes


def main(argv: list[str]) -> int:
    src, dst = argv[1], argv[2]
    only = {int(a) for a in argv[3:]}
    files = sorted((f for f in os.listdir(src) if f.endswith(".mscz")), key=hymn_number)
    import json
    ok = 0
    for f in files:
        n = hymn_number(f)
        if only and n not in only:
            continue
        try:
            number, data, info = convert_file(os.path.join(src, f))
        except Exception as e:  # report and continue
            print(f"FAIL {n}: {type(e).__name__}: {e}")
            continue
        out = os.path.join(dst, f"{number:03d}")
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, "score.musicxml"), "wb") as fh:
            fh.write(data)
        with open(os.path.join(out, "source.json"), "w", encoding="utf-8", newline="") as fh:
            json.dump(info, fh, ensure_ascii=False, indent=1)
        ok += 1
    print(f"converted {ok} files")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
