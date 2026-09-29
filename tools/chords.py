"""Chord symbols for a band, read from the four-part harmony of each hymn.

The scores have soprano, alto, tenor and bass but no chord letters. For every beat this collects
the notes all four voices sound (weighted by how long they sound in the beat, with notes struck
on the beat counting more), picks the chord that explains them best, and names it the way lead
sheets do: G, Em, D7, Cmaj7, F#dim, Dsus4, and C/G when the bass is not the root. A chord is
written only where the harmony changes, at most once per beat, and only where the top staff
starts a note (so the letter sits above the melody).

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
        beat = Fraction(3, 2) if compound else Fraction(1)  # quarter beats, dotted quarters in 6/8
        nominal = Fraction(beats * 4, beat_type)
        length = longest if longest > 0 else nominal
        measures.append((m, t0, length, beat, fifths))
        t0 += length
    return notes, measures


def name_pc(pc: int, notes_in_window: list[Note], fifths: int) -> tuple[str, int]:
    """Spell a pitch class as the score spells it, else by the key signature's side."""
    for n in notes_in_window:
        if (STEP_PC[n.step] + n.alter) % 12 == pc:
            return n.step, n.alter
    return (FLAT_NAMES if fifths < 0 else SHARP_NAMES)[pc]


def best_chord(weights: dict[int, float], bass_pc: int | None, fifths: int):
    """Choose (root pc, kind index) that best explains the weighted pitch classes."""
    total = sum(weights.values()) or 1
    scale = {(fifths * 7 + i) % 12 for i in (0, 2, 4, 5, 7, 9, 11)}  # major scale of the key
    best, best_score = None, -1e9
    for root in range(12):
        for ki, (_, _, tones, seventh) in enumerate(KINDS):
            pcs = {(root + t) % 12 for t in tones}
            inside = sum(w for pc, w in weights.items() if pc in pcs)
            outside = sum(w for pc, w in weights.items() if pc not in pcs)
            score = inside - 1.3 * outside
            third = (root + tones[1]) % 12
            if third not in weights:
                score -= 0.35 * total  # a chord is named by its third
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
            if score > best_score:
                best, best_score = (root, ki), score
    return best


KIND_TONES = {kind: tones for kind, _, tones, _ in KINDS}


def fit(root_pc: int, kind: str, weights: dict[int, float]) -> float:
    """Share of the beat's sounding weight that belongs to the chord, 0 to 1."""
    total = sum(weights.values())
    if not total:
        return 0.0
    pcs = {(root_pc + t) % 12 for t in KIND_TONES[kind]}
    return sum(w for pc, w in weights.items() if pc in pcs) / total


def analyse(root):
    """[(time, measure element, anchor note element, root spelling, kind, bass spelling or None)]"""
    notes, measures = read_notes(root)
    notes.sort(key=lambda n: (n.start, n.midi))
    out = []
    prev = None
    for m, t0, length, beat, fifths in measures:
        t = t0
        while t < t0 + length - Fraction(1, 64):
            w_end = min(t + beat, t0 + length)
            window = [n for n in notes if n.start < w_end and n.end > t]
            if not window:
                prev = None
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
            at_beat = [n for n in window if n.start <= t < n.end]
            bass_note = min(at_beat or window, key=lambda n: n.midi)
            bass_pc = bass_note.midi % 12
            root_pc, ki = best_chord(weights, bass_pc, fifths)
            kind = KINDS[ki][0]
            if kind == "diminished":
                # a diminished triad in a hymn is almost always a dominant seventh without its root
                # (B-D-F under G7); band charts write G7
                root_pc, kind = (root_pc - 4) % 12, "dominant"
            if kind in ("suspended-fourth", "major-seventh"):
                # a 4-3 suspension resolves to the triad and a major seventh is a passing tone;
                # a hymn chart writes the plain chord (C, not Csus4 or Cmaj7)
                kind = "major"
            if kind in ("minor", "minor-seventh") and (bass_pc - root_pc) % 12 == 3:
                # a minor chord over its own third (Bb-Db-F over Db) is the major chord with an
                # added sixth; charts write the major chord on the bass note
                root_pc, kind = bass_pc, "major"
            elif kind == "half-diminished" and (bass_pc - root_pc) % 12 == 3:
                # B-D-F-A over D is D minor with an added sixth; charts write Dm
                root_pc, kind = bass_pc, "minor"
            # the top staff must start a note here, so the letter sits above the melody
            anchors = [n for n in notes if n.start == t and n.staff == "1"]
            chord = (root_pc, kind, bass_pc if bass_pc != root_pc else None)
            voices = {n.voice for n in window}
            if len(voices) < 2:
                # a melody alone (a pickup, a solo bar) does not set a chord: keep the letter
                chord = prev
            elif prev is not None:
                # a chart changes chord only when the harmony really moves; passing notes and a
                # bass holding the old root under moving upper voices keep the letter
                old = fit(prev[0], prev[1], weights)
                new = fit(root_pc, kind, weights)
                strong = ((t - t0) % (2 * beat)) == 0
                margin = 0.2 if strong else 0.35
                if old >= 0.5 and new - old < margin:
                    chord = prev
                elif bass_pc == prev[0] and (old >= 0.6 or not strong):
                    chord = prev  # pedal bass: upper voices passing over the old root on a weak beat
            if chord != prev and anchors:
                anchor = min(anchors, key=lambda n: -n.midi).el
                r = name_pc(root_pc, window, fifths)
                b = name_pc(bass_pc, [bass_note] + window, fifths) if chord[2] is not None else None
                out.append((t, m, anchor, r, kind, b))
                prev = chord
            elif chord != prev and not anchors:
                pass  # harmony moves under a held melody note: keep the previous letter
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
