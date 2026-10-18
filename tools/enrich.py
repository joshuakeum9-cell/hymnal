"""Fuller chords for a praise song, built on the book's (the 풍성 style; the book's own stay as 악보집).

Every book chord keeps its root and its job in the key; the enrichment only colours it, the way a
worship band voices a chart:

  colour     I and IV take maj7 or 2, ii iii vi take m7, a V that goes home takes sus4 then V (or V7)
  bass       an inversion where it makes the bass walk by step (C G/B Am, F/A), chosen as a best path
  passing    on a long chord, a passing slash chord on a note already there: I to vi through I/7
             (G G/F# Em), I to IV through I/3 (G G/B C), vi to IV through vi/b7 (Em Em/D C)

Nothing is added that rubs against the melody: an added note is never a semitone from a melody note
that is held or on a beat, a sus4 never sounds with the melody's third, and a bass is never a
semitone from such a note. A chord the book already colours (Am7, D/F#, Esus4) is kept as printed.
"""
from __future__ import annotations

import re
from fractions import Fraction as F

STEPS = "CDEFGAB"
PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
MAJOR_LETTER = {0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F#", 7: "C#",
                -1: "F", -2: "Bb", -3: "Eb", -4: "Ab", -5: "Db", -6: "Gb", -7: "Cb"}
CHORD = re.compile(r"([A-G])([#b]?)([^/]*)(?:/([A-G])([#b]?))?")


def name(letter_index: int, pc: int) -> str:
    letter = STEPS[letter_index % 7]
    alter = (pc - PC[letter] + 6) % 12 - 6
    return letter + ("#" * alter if alter > 0 else "b" * -alter)


def tonic(fifths: int, mode: str) -> int:
    major = MAJOR_LETTER[fifths]
    pc = PC[major[0]] + {"#": 1, "b": -1}.get(major[1:], 0)
    return (pc + (9 if mode == "minor" else 0)) % 12


class Span:
    """One book chord and the melody under it, up to the next chord."""
    def __init__(self, ev, sym, measure, at_bar):
        self.ev, self.sym, self.measure, self.at_bar = ev, sym, measure, at_bar
        self.events = []  # (ev, onset from the span start, onset in its bar)
        self.length = F(0)
        m = CHORD.fullmatch(sym)
        self.letter = STEPS.index(m.group(1))
        self.root = (PC[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]) % 12
        self.suffix = m.group(3)
        self.slash = bool(m.group(4))
        self.minor = self.suffix.startswith("m") and not self.suffix.startswith("maj")
        self.plain = self.suffix in ("", "m") and not self.slash

    def melody(self, start=F(0), end=None):
        """(pc, held or on a beat) for melody notes sounding in [start, end) of the span."""
        out = []
        for ev, t, tb in self.events:
            if ev.rest or (end is not None and t >= end) or t + ev.dur <= start:
                continue
            strong = ev.dur >= F(1, 2) or tb % 1 == 0 or t <= start
            out.append(((PC[ev.step] + ev.alter) % 12, strong))
        return out

    def rubs(self, pc, start=F(0), end=None):
        """True when pc is a semitone from a held or on-beat melody note."""
        return any(s and (pc - m) % 12 in (1, 11) for m, s in self.melody(start, end))


def spans_of(measures, metas, pickup):
    spans, cur = [], None
    for i, evs in enumerate(measures):
        t = F(0)
        for ev in evs:
            if ev.chord:
                cur = Span(ev, ev.chord, i, t)
                cur.key = (metas[i]["fifths"], metas[i]["mode"])
                cur.meta = metas[i]
                spans.append(cur)
            if cur is not None:
                cur.events.append((ev, cur.length, t))
                cur.length += ev.dur
            t += ev.dur
    return spans


def colour(sp, nxt, last, prev=None):
    """The span's chord with an added note, or (sus4 chord, resolution, where) for a V going home."""
    if not sp.plain:
        return sp.sym
    t = tonic(*sp.key)
    deg = (sp.root - t) % 12
    minor_key = sp.key[1] == "minor"
    mel = {pc for pc, s in sp.melody()}
    base = name(sp.letter, sp.root) + ("m" if sp.minor else "")
    goes_home = nxt is not None and (nxt.root - t) % 12 == 0
    if not sp.minor and (deg == 7 or (minor_key and deg == 7)):  # V
        already_sus = prev is not None and prev.root == sp.root and "sus" in prev.suffix
        if goes_home and sp.length >= 2 and not already_sus:
            third = (sp.root + 4) % 12
            for ev, at, tb in sp.events[1:]:
                if at >= sp.length / 2 and at < sp.length and not ev.rest:
                    if third not in {pc for pc, _ in sp.melody(F(0), at)} and not sp.rubs((sp.root + 5) % 12, F(0), at):
                        return (base + "sus4", base, ev)
                    break
        if goes_home and not sp.rubs((sp.root + 10) % 12):
            return base + "7"
        return sp.sym
    if sp.minor:
        if not sp.rubs((sp.root + 10) % 12):
            return base + "7"
        return sp.sym
    # major chords that are not V: the key's I and IV (III VI VII in minor) take maj7 or 2
    if (not minor_key and deg in (0, 5)) or (minor_key and deg in (3, 8)):
        seventh, second = (sp.root + 11) % 12, (sp.root + 2) % 12
        if seventh in mel and not sp.rubs(seventh):
            return base + "maj7"
        if second in mel and not sp.rubs(second):
            return base + "2"
        if sp.length >= 2 and not last:
            if deg == 5 and not sp.rubs(seventh):
                return base + "maj7"
            if not sp.rubs(second):
                return base + "2"
        if last and not sp.rubs(second):
            return base + "2"
    return sp.sym


def passing(sp, nxt):
    """(event, slash chord) for a passing bass inside a long plain major or minor chord."""
    if nxt is None or not sp.plain or sp.length < 2:
        return None
    t = tonic(*sp.key)
    deg, ndeg = (sp.root - t) % 12, (nxt.root - t) % 12
    minor_key = sp.key[1] == "minor"
    base = name(sp.letter, sp.root) + ("m" if sp.minor else "")
    plan = None
    if not minor_key and deg == 0 and not sp.minor:
        if ndeg == 9:    # I to vi: I/7
            plan = (6, 11)
        elif ndeg == 5:  # I to IV: I/3
            plan = (2, 4)
    if not minor_key and deg == 9 and sp.minor and ndeg == 5:  # vi to IV: vi/b7, bass walking down
        plan = (6, 10)
    if plan is None:
        return None
    steps, semis = plan
    bass = (sp.root + semis) % 12
    for ev, at, tb in sp.events[1:]:
        if at >= sp.length / 2 and not ev.rest and tb % F(1, 2) == 0:
            if sp.rubs(bass, at):
                return None
            return ev, f"{base}/{name(sp.letter + steps, bass)}"
    return None


def inversions(chain):
    """Best bass path over the chords: root position unless a third in the bass makes it walk."""
    def options(sym):
        m = CHORD.fullmatch(sym)
        root = (PC[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]) % 12
        if m.group(4):
            return [(sym, (PC[m.group(4)] + {"#": 1, "b": -1, "": 0}[m.group(5)]) % 12, 0.0)]
        out = [(sym, root, 0.0)]
        suffix = m.group(3)
        minor = suffix.startswith("m") and not suffix.startswith("maj")
        if suffix in ("", "2", "maj7", "7", "m", "m7") and "sus" not in suffix:
            third = (root + (3 if minor else 4)) % 12
            out.append((f"{sym}/{name(STEPS.index(m.group(1)) + 2, third)}", third, 1.4 if minor else 0.8))
        return out

    def move(a, b):
        d = min((a - b) % 12, (b - a) % 12)
        return {0: 0.4, 1: 0.0, 2: 0.0, 3: 0.5, 4: 0.5, 5: 0.6}.get(d, 1.0)

    best = []
    for j, (sp, sym) in enumerate(chain):
        row = {}
        for k, (s, bass, cost) in enumerate(options(sym)):
            if k and (j == 0 or j == len(chain) - 1):
                continue  # start and end on the root
            if k and sp.rubs(bass):
                continue
            if j == 0:
                row[k] = (cost, None, s, bass)
                continue
            row[k] = min((pc + cost + move(pb, bass), pk, s, bass) for pk, (pc, _, _, pb) in best[-1].items())
        best.append(row)
    k = min(best[-1], key=lambda k: best[-1][k][0])
    out = []
    for j in range(len(best) - 1, -1, -1):
        cost, prev, s, _ = best[j][k]
        out.append(s)
        k = prev
    return out[::-1]


def enrich(measures, metas, pickup) -> int:
    """Sets ev.rich on every event that has a book chord (and on passing notes). Returns how many
    chords changed."""
    spans = spans_of(measures, metas, pickup)
    for e in (e for evs in measures for e in evs):
        e.rich = None
    plan = []  # (span, event, symbol) in order
    for j, sp in enumerate(spans):
        nxt = spans[j + 1] if j + 1 < len(spans) else None
        c = colour(sp, nxt, nxt is None, spans[j - 1] if j else None)
        if isinstance(c, tuple):
            sus, res, at = c
            plan += [(sp, sp.ev, sus), (sp, at, res)]
            continue
        plan.append((sp, sp.ev, c))
        p = passing(sp, nxt)
        if p:
            plan.append((sp, p[0], p[1]))
    # inversions for the colour chords (a passing slash keeps its own bass)
    syms = inversions([(sp, s) for sp, ev, s in plan])
    changed = 0
    for (sp, ev, _), s in zip(plan, syms):
        ev.rich = s
        changed += ev.chord != s
    return changed
