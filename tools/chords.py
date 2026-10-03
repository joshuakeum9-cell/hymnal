"""Chord symbols for a band, read from the four-part harmony of each hymn.

The scores have soprano, alto, tenor and bass but no chord letters. For every beat this collects
the notes all four voices sound (weighted by how long they sound in the beat, with notes struck
on the beat counting more), picks the chord that explains them best, and names it the way hymn
band charts do: G, Em, D7, Am7, F#dim7, and G/B when the bass holds a chord tone other than the
root. A chord is written only where the harmony changes, at most once per beat, and only where
the top staff starts a note (so the letter sits above the melody). Keeping the previous letter
and choosing a new one are judged by the same score, so a seventh chord never swallows the plain
triads that follow it. Roots are spelled as the key spells them (Db, not C#, in A-flat), slash
basses from the chord's root (F7/C, never F7/B#). A unison line gets no chord.

The symbols are MusicXML <harmony> elements, so the renderer transposes them with the music.

Usage: python tools/chords.py 405          (prints the chords of one hymn, for checking)
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from fractions import Fraction

from lxml import etree

STEP_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SHARP_NAMES = [("C", 0), ("C", 1), ("D", 0), ("D", 1), ("E", 0), ("F", 0), ("F", 1), ("G", 0), ("G", 1), ("A", 0), ("A", 1), ("B", 0)]
FLAT_NAMES = [("C", 0), ("D", -1), ("D", 0), ("E", -1), ("E", 0), ("F", 0), ("G", -1), ("G", 0), ("A", -1), ("A", 0), ("B", -1), ("B", 0)]

# (MusicXML kind, text shown in the check printout, chord tones above the root, is a seventh chord)
KINDS = [
    ("major", "", (0, 4, 7), False),
    ("minor", "m", (0, 3, 7), False),
    ("diminished", "dim", (0, 3, 6), False),
    ("augmented", "aug", (0, 4, 8), False),
    ("suspended-fourth", "sus4", (0, 5, 7), False),
    ("dominant", "7", (0, 4, 7, 10), True),
    ("major-seventh", "maj7", (0, 4, 7, 11), True),
    ("minor-seventh", "m7", (0, 3, 7, 10), True),
    ("half-diminished", "m7b5", (0, 3, 6, 10), True),
    ("diminished-seventh", "dim7", (0, 3, 6, 9), True),
]


@dataclass
class Note:
    start: Fraction      # in quarter notes from the start of the piece
    end: Fraction
    midi: int
    step: str
    alter: int
    staff: str
    voice: str
    el: etree._Element


def read_notes(root):
    """All sounding notes with absolute times (quarter notes), plus per-measure info."""
    notes: list[Note] = []
    measures = []  # (measure element, start, length, beat length)
    divisions = 1
    beats, beat_type = 4, 4
    t0 = Fraction(0)
    fifths = 0
    for m in root.iter("measure"):
        a = m.find("attributes")
        if a is not None:
            if a.findtext("divisions"):
                divisions = int(a.findtext("divisions"))
            ts = a.find("time")
            if ts is not None and ts.findtext("beats"):
                try:
                    beats, beat_type = int(ts.findtext("beats").split("+")[0]), int(ts.findtext("beat-type"))
                except ValueError:
                    pass
            k = a.find("key")
            if k is not None and k.findtext("fifths") is not None:
                fifths = int(k.findtext("fifths"))
        pos = Fraction(0)
        longest = Fraction(0)
        last_start = Fraction(0)
        for el in m:
            if el.tag == "backup":
                pos -= Fraction(int(el.findtext("duration")), divisions)
                continue
            if el.tag == "forward":
                pos += Fraction(int(el.findtext("duration")), divisions)
                longest = max(longest, pos)
                continue
            if el.tag != "note":
                continue
            if el.find("grace") is not None:
                continue
            d = Fraction(int(el.findtext("duration") or 0), divisions)
            is_chord = el.find("chord") is not None
            start = last_start if is_chord else pos
            p = el.find("pitch")
            if p is not None and el.find("rest") is None:
                step = p.findtext("step")
                alter = int(float(p.findtext("alter") or 0))
                midi = (int(p.findtext("octave")) + 1) * 12 + STEP_PC[step] + alter
                notes.append(Note(t0 + start, t0 + start + d, midi, step, alter, el.findtext("staff") or "1", el.findtext("voice") or "1", el))
            if not is_chord:
                last_start = pos
                pos += d
                longest = max(longest, pos)
        compound = beat_type == 8 and beats % 3 == 0
        # quarter beats; dotted quarters in 6/8; half notes in 2/2, 3/2 and 4/2, where a chord on
        # every quarter would crowd the letters
        beat = Fraction(3, 2) if compound else Fraction(2) if beat_type == 2 else Fraction(1)
        nominal = Fraction(beats * 4, beat_type)
        length = longest if longest > 0 else nominal
        measures.append((m, t0, length, beat, fifths))
        t0 += length
    return notes, measures


def key_spelling(fifths: int) -> dict[int, tuple[str, int]]:
    """The seven pitch classes of the key's major scale, spelled as the key signature spells them."""
    tonic_step = "FCGDAEB"[(fifths + 1) % 7]
    tonic_pc = (fifths * 7) % 12
    letters = "CDEFGAB"
    i0 = letters.index(tonic_step)
    out = {}
    for deg, semis in enumerate((0, 2, 4, 5, 7, 9, 11)):
        step = letters[(i0 + deg) % 7]
        pc = (tonic_pc + semis) % 12
        out[pc] = (step, (pc - STEP_PC[step] + 6) % 12 - 6)
    return out


def name_pc(pc: int, notes_in_window: list[Note], fifths: int) -> tuple[str, int]:
    """Spell a pitch class the way the key does (Db, not C#, in A-flat); a note outside the key
    keeps the score's own spelling (the F# of a D7 in C), else the key signature's side."""
    diatonic = key_spelling(fifths)
    if pc in diatonic:
        return diatonic[pc]
    for n in notes_in_window:
        if (STEP_PC[n.step] + n.alter) % 12 == pc:
            return n.step, n.alter
    return (FLAT_NAMES if fifths < 0 else SHARP_NAMES)[pc]


def spell_from_root(root: tuple[str, int], pc: int) -> tuple[str, int]:
    """Spell a chord tone from the chord's root: the third of F is A, its fifth C (never B#)."""
    letters = "CDEFGAB"
    interval = (pc - STEP_PC[root[0]] - root[1]) % 12
    steps = {0: 0, 3: 2, 4: 2, 6: 4, 7: 4, 8: 4, 9: 6, 10: 6, 11: 6}.get(interval, 0)
    step = letters[(letters.index(root[0]) + steps) % 7]
    return step, (pc - STEP_PC[step] + 6) % 12 - 6


def spell_chord(chord, window: list[Note], fifths: int):
    """Root and slash-bass spellings. A root outside the key whose name or bass would need B#,
    E#, Cb, Fb or a double accidental (D#7/F##) is spelled the other way round (Eb7/G)."""
    def odd(s):
        return s is not None and (abs(s[1]) > 1 or s in (("B", 1), ("E", 1), ("C", -1), ("F", -1)))

    pc, _, bass = chord
    first = name_pc(pc, window, fifths)
    options = [first]
    if pc not in key_spelling(fifths):
        options += [SHARP_NAMES[pc], FLAT_NAMES[pc]]
    for r in options:
        b = spell_from_root(r, bass) if bass is not None else None
        if not odd(r) and not odd(b):
            return r, b
    return first, spell_from_root(first, bass) if bass is not None else None


def chord_score(root: int, ki: int, weights: dict[int, float], bass_pc: int | None, scale: set[int]) -> float:
    """How well (root, kind) explains the weighted pitch classes of a beat; higher is better."""
    total = sum(weights.values()) or 1
    _, _, tones, seventh = KINDS[ki]
    pcs = {(root + t) % 12 for t in tones}
    inside = sum(w for pc, w in weights.items() if pc in pcs)
    outside = sum(w for pc, w in weights.items() if pc not in pcs)
    score = inside - 1.3 * outside
    third = (root + tones[1]) % 12
    if third not in weights:
        score -= 0.35 * total  # a chord is named by its third
        if third in scale:
            score += 0.05 * total  # a bare fifth or unison takes the key's own quality (Dm in D minor)
    if (root + tones[2]) % 12 not in weights:
        score -= 0.08 * total
    if root not in weights:
        score -= 0.5 * total
    if seventh:
        sev = (root + tones[3]) % 12
        if weights.get(sev, 0) < 0.12 * total:
            score -= 0.5 * total  # only call it a 7th chord when the 7th really sounds
        score -= 0.03 * total
    if KINDS[ki][0] in ("augmented", "diminished-seventh"):
        score -= 0.1 * total
    if KINDS[ki][0] == "suspended-fourth":
        score -= 0.12 * total
    if bass_pc is not None and root == bass_pc:
        score += 0.15 * total
    if root not in scale:
        score -= 0.06 * total
    return score


def best_chord(weights: dict[int, float], bass_pc: int | None, fifths: int):
    """Choose (root pc, kind index) that best explains the weighted pitch classes, with its score."""
    scale = {(fifths * 7 + i) % 12 for i in (0, 2, 4, 5, 7, 9, 11)}  # major scale of the key
    best, best_score = None, -1e9
    for root in range(12):
        for ki in range(len(KINDS)):
            score = chord_score(root, ki, weights, bass_pc, scale)
            if score > best_score:
                best, best_score = (root, ki), score
    return best, best_score


KIND_TONES = {kind: tones for kind, _, tones, _ in KINDS}


def relabel(root_pc: int, kind: str, bass_pc: int, melody_pc: int | None = None, sounding: set[int] = frozenset()) -> tuple[int, str]:
    """Name a chord the way a hymn band chart does."""
    over_third = (bass_pc - root_pc) % 12 == 3
    if kind == "suspended-fourth" and sounding and (root_pc + 7) % 12 not in sounding:
        # a bare fourth with no fifth (Eb-Ab at a final cadence) is the chord a fourth up over its
        # fifth, Ab/Eb, not Eb
        return (root_pc + 5) % 12, "major"
    if kind == "minor-seventh" and over_third:
        # D-F-A-C over F is exactly F6: charts write F, not Dm7/F
        return bass_pc, "major"
    if kind == "minor" and over_third and melody_pc == root_pc:
        # a minor chord over its own third with its root in the melody (Bb over Db-F) is the major
        # chord with the melody on its sixth: charts write Db; with the sixth in an inner voice
        # the minor chord stands (Am/C)
        return bass_pc, "major"
    if kind == "suspended-fourth" and (bass_pc - root_pc) % 12 == 5:
        # C-F-G over F is F with a passing ninth above its bass, not C: the bass is the root
        return bass_pc, "major"
    if kind == "diminished":
        # a diminished triad in a hymn is almost always a dominant seventh without its root
        # (B-D-F under G7); band charts write G7
        return (root_pc - 4) % 12, "dominant"
    if kind in ("suspended-fourth", "major-seventh", "augmented"):
        # a 4-3 suspension resolves to the triad, a major seventh or a raised fifth is a
        # passing tone; a hymn chart writes the plain chord (C, not Csus4, Cmaj7 or C+)
        return root_pc, "major"
    if kind == "half-diminished" and (bass_pc - root_pc) % 12 == 3:
        # B-D-F-A over D is D minor with an added sixth; charts write Dm
        return bass_pc, "minor"
    return root_pc, kind


def is_unison(window: list[Note]) -> bool:
    """Every voice on the same pitch (in octaves) wherever a note starts: a unison line has no
    harmony to read, so it must not invent one (hymn 26 is unison throughout)."""
    for s in {n.start for n in window}:
        if len({n.midi % 12 for n in window if n.start <= s < n.end}) > 1:
            return False
    return True


def analyse(root):
    """[(time, measure element, anchor note element, root spelling, kind, bass spelling or None)]"""
    notes, measures = read_notes(root)
    notes.sort(key=lambda n: (n.start, n.midi))
    out = []
    prev = None      # the chord last written: (root pc, kind, slash bass pc or None)
    prev_raw = None  # its analysis before relabelling: (root pc, kind index), for scoring later beats
    for m, t0, length, beat, fifths in measures:
        scale = {(fifths * 7 + i) % 12 for i in (0, 2, 4, 5, 7, 9, 11)}
        t = t0
        while t < t0 + length - Fraction(1, 64):
            w_end = min(t + beat, t0 + length)
            window = [n for n in notes if n.start < w_end and n.end > t]
            voices = {(n.staff, n.voice) for n in window}
            if not window or len(voices) < 2 or is_unison(window):
                # a rest, a melody alone (a pickup, a solo bar) or a unison line sets no chord
                t = w_end
                continue
            weights: dict[int, float] = {}
            for n in window:
                ov = float(min(n.end, w_end) - max(n.start, t))
                if n.start == t:
                    ov *= 1.5  # struck on the beat
                if n.start < t:
                    ov *= 0.8  # held over from before
                pc = n.midi % 12
                weights[pc] = weights.get(pc, 0) + ov
            total = sum(weights.values())
            at_beat = [n for n in window if n.start <= t < n.end]
            bass_note = min(at_beat or window, key=lambda n: n.midi)
            bass_pc = bass_note.midi % 12
            top = max(at_beat or window, key=lambda n: n.midi)
            (raw_root, raw_ki), best_score = best_chord(weights, bass_pc, fifths)
            root_pc, kind = relabel(raw_root, KINDS[raw_ki][0], bass_pc, top.midi % 12, set(weights))
            tones = {(root_pc + i) % 12 for i in KIND_TONES[kind]}
            # a slash names an inversion the bass holds (struck again on the same note counts); a
            # bass outside the chord, or one walking on within the beat, is a passing note
            def lowest_at(s):
                return min((n for n in window if n.start <= s < n.end), key=lambda n: n.midi, default=bass_note)
            onsets = {n.start for n in window if n.start > t} | {t}
            held = all(lowest_at(s).midi % 12 == bass_pc for s in onsets)
            chord = (root_pc, kind, bass_pc if bass_pc != root_pc and bass_pc in tones and held else None)
            raw = (raw_root, raw_ki)
            strong = ((t - t0) % (2 * beat)) == 0
            if prev is not None and chord[:2] != prev[:2]:
                # a chart changes chord only when the harmony really moves: keep the letter while it
                # explains this beat nearly as well as the best chord does (passing notes, a bass
                # holding the old root under moving upper voices). Both are judged by the same score,
                # so a seventh chord cannot swallow a later plain triad (Em7 is not G-B-D).
                prev_score = chord_score(prev_raw[0], prev_raw[1], weights, bass_pc, scale)
                margin = (0.15 if strong else 0.3) * total
                if prev_score >= best_score - margin:
                    chord, raw = prev, prev_raw
                elif bass_pc == prev[0] and not strong and prev_score >= best_score - 0.5 * total:
                    chord, raw = prev, prev_raw  # pedal bass under passing upper voices
            if prev is not None and chord[:2] == prev[:2] and chord != prev:
                # same chord, new bass: rewrite the letter on a strong beat (G to G/B, or Bb/F back to
                # Bb once the bass leaves the F); a walking bass on weak beats keeps it
                prev_tones = {(prev[0] + i) % 12 for i in KIND_TONES[prev[1]]}
                if strong and bass_note.start == t and (held or (prev[2] is not None and prev[2] != bass_pc)):
                    chord = (prev[0], prev[1], bass_pc if bass_pc != prev[0] and bass_pc in prev_tones and held else None)
                else:
                    chord = prev
            # the top staff must start a note here, so the letter sits above the melody
            anchors = [n for n in notes if n.start == t and n.staff == "1"]
            if chord != prev and anchors:
                anchor = min(anchors, key=lambda n: -n.midi).el
                r, b = spell_chord(chord, window, fifths)
                out.append((t, m, anchor, r, chord[1], b))
                prev, prev_raw = chord, raw
            # with no note starting on the top staff the harmony moves under a held melody note:
            # the previous letter stays
            t = w_end
    return out


def add_chords(root) -> int:
    """Insert <harmony> elements before their anchor notes. Returns how many were added."""
    found = analyse(root)
    for t, m, anchor, (rs, ra), kind, bass in found:
        h = etree.Element("harmony", {"print-frame": "no"})
        r = etree.SubElement(h, "root")
        etree.SubElement(r, "root-step").text = rs
        if ra:
            etree.SubElement(r, "root-alter").text = str(ra)
        text = {"major": "", "minor": "m", "diminished": "dim", "augmented": "+", "suspended-fourth": "sus4",
                "dominant": "7", "major-seventh": "maj7", "minor-seventh": "m7", "half-diminished": "m7b5",
                "diminished-seventh": "dim7"}[kind]
        etree.SubElement(h, "kind", {"text": text}).text = kind
        if bass:
            b = etree.SubElement(h, "bass")
            etree.SubElement(b, "bass-step").text = bass[0]
            if bass[1]:
                etree.SubElement(b, "bass-alter").text = str(bass[1])
        etree.SubElement(h, "staff").text = "1"
        anchor.addprevious(h)
    return len(found)


def label(r, kind, b) -> str:
    acc = {1: "#", -1: "b", 2: "##", -2: "bb", 0: ""}
    s = r[0] + acc[r[1]] + dict((k, t) for k, t, _, _ in KINDS)[kind]
    if b:
        s += "/" + b[0] + acc[b[1]]
    return s


if __name__ == "__main__":
    import os
    ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for a in sys.argv[1:]:
        tree = etree.parse(os.path.join(ROOT, f"data/hymns/{int(a):03d}/score.musicxml"))
        res = analyse(tree.getroot())
        line, cur = [], None
        for t, m, _, r, kind, b in res:
            if m.get("number") != cur:
                line.append(f"| m{m.get('number')}:")
                cur = m.get("number")
            line.append(label(r, kind, b))
        print(a, " ".join(line))
