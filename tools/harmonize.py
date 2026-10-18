"""Chord letters for a melody-only praise song, by rule.

Each half bar (a whole bar in 3/4 and 2/4) takes one chord from the key's family: I ii iii IV V vi
in major, i iv V v III VI VII in minor. A chord outside the family (V/V, V/vi, I7, bVII) is only
considered when the melody sings the chromatic note that asks for it. The choice is a best path
(Viterbi) over the song: chord tones in the melody score up (more on strong beats and long notes),
other notes score down, and common moves (V-I, IV-V, ii-V) and staying put score up. The song
starts on the tonic and ends V-I. A letter is written only where the chord changes, and again at
repeat starts, endings, segno and coda, where the reader jumps in.
"""
from __future__ import annotations

from fractions import Fraction as F

LETTERS = "CDEFGAB"
PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
MAJOR_LETTER = {0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F", 7: "C",
                -1: "F", -2: "B", -3: "E", -4: "A", -5: "D", -6: "G", -7: "C"}
QUALITY = {"": (0, 4, 7), "m": (0, 3, 7), "7": (0, 4, 7, 10)}
MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
MINOR_SCALE = (0, 2, 3, 5, 7, 8, 10)
# (name, scale degree, root shift, quality, prior, chromatic note it needs, relative to the tonic)
MAJOR = [("I", 0, 0, "", 0.3, None), ("ii", 1, 0, "m", 0.0, None), ("iii", 2, 0, "m", -0.3, None),
         ("IV", 3, 0, "", 0.2, None), ("V", 4, 0, "", 0.2, None), ("vi", 5, 0, "m", 0.1, None),
         ("II", 1, 0, "", -0.5, 6), ("III", 2, 0, "", -0.6, 8), ("I7", 0, 0, "7", -0.5, 10),
         ("bVII", 6, -1, "", -0.5, 10)]
MINOR = [("i", 0, 0, "m", 0.3, None), ("iv", 3, 0, "m", 0.15, None), ("V", 4, 0, "", 0.15, None),
         ("v", 4, 0, "m", -0.2, None), ("III", 2, 0, "", 0.05, None), ("VI", 5, 0, "", 0.1, None),
         ("VII", 6, 0, "", 0.05, None)]
MOVES = {("V", "I"): 0.4, ("IV", "V"): 0.15, ("ii", "V"): 0.25, ("IV", "I"): 0.15, ("vi", "IV"): 0.1,
         ("vi", "ii"): 0.1, ("V", "vi"): 0.1, ("V", "IV"): -0.2, ("V", "ii"): -0.3, ("II", "V"): 0.4,
         ("III", "vi"): 0.4, ("I7", "IV"): 0.4, ("bVII", "IV"): 0.2, ("bVII", "I"): 0.2,
         ("V", "i"): 0.4, ("iv", "V"): 0.2, ("VI", "VII"): 0.15, ("VII", "III"): 0.15, ("VII", "i"): 0.1,
         ("iv", "i"): 0.1, ("VI", "iv"): 0.05}
STAY, CHANGE = 0.15, -0.1
LONG, RUN_FREE, RUN_CAP = 0.2, 4, 12  # a chord runs four segments (two bars of 4/4) for free


class Family:
    def __init__(self, fifths: int, mode: str):
        major_letter = MAJOR_LETTER[fifths]
        self.minor = mode == "minor"
        li = LETTERS.index(major_letter) + (5 if self.minor else 0)
        self.alters = _key_alters(fifths)
        tonic_letter = LETTERS[li % 7]
        self.tonic = (PC[tonic_letter] + self.alters.get(tonic_letter, 0)) % 12
        scale = MINOR_SCALE if self.minor else MAJOR_SCALE
        self.chords = []
        for name, deg, shift, q, prior, needs in (MINOR if self.minor else MAJOR):
            letter = LETTERS[(li + deg) % 7]
            alter = self.alters.get(letter, 0) + shift
            root = (self.tonic + scale[deg] + shift) % 12
            tones = {(root + i) % 12 for i in QUALITY[q]}
            sym = letter + ("#" * alter if alter > 0 else "b" * -alter) + q
            self.chords.append({"name": name, "sym": sym, "tones": tones, "prior": prior,
                                "needs": None if needs is None else (self.tonic + needs) % 12,
                                "seventh": (root + 10) % 12 if name == "V" else None})


def _key_alters(fifths: int) -> dict[str, int]:
    if fifths >= 0:
        return {s: 1 for s in "FCGDAEB"[:fifths]}
    return {s: -1 for s in "BEADGCF"[:-fifths]}


def _segments(measures, metas, pickup):
    """-> list of segments: notes sounding (pc, weight), the event a letter can sit on, flags."""
    segs = []
    for i, (evs, meta) in enumerate(zip(measures, metas)):
        nominal = F(meta["beats"] * 4, meta["beat_type"])
        length = sum(e.dur for e in evs)
        step = F(2) if (meta["beats"], meta["beat_type"]) in ((4, 4), (2, 2)) else nominal
        if pickup and i == 0:
            bounds = [F(0), length]
        else:
            bounds = [F(0)]
            while bounds[-1] + step < length:
                bounds.append(bounds[-1] + step)
            bounds.append(length)
        onsets, t = [], F(0)
        for e in evs:
            onsets.append(t)
            t += e.dur
        for k in range(len(bounds) - 1):
            s, end = bounds[k], bounds[k + 1]
            seg = {"measure": i, "first": k == 0, "notes": [], "ev": None}
            for e, t0 in zip(evs, onsets):
                t1 = t0 + e.dur
                if seg["ev"] is None and s <= t0 < end:
                    seg["ev"] = e
                if e.rest or t1 <= s or t0 >= end:
                    continue
                d = min(t1, end) - max(t0, s)
                w = float(d)
                if t0 < s or e.tie_stop:
                    w *= 0.7  # still sounding from before
                elif t0 == s:
                    w *= 1.6
                elif t0 % 1 == 0:
                    w *= 1.2
                long_ = d >= 1 or t0 == s
                seg["notes"].append(((PC[e.step] + e.alter) % 12, w, long_))
            segs.append(seg)
    return segs


def harmonize(measures, metas, pickup) -> int:
    """Sets ev.chord on the events where a letter is written. Returns how many letters."""
    segs = _segments(measures, metas, pickup)
    if not segs:
        return 0
    fams = [Family(metas[s["measure"]]["fifths"], metas[s["measure"]]["mode"]) for s in segs]
    last_sounding = max((j for j, s in enumerate(segs) if s["notes"]), default=len(segs) - 1)
    first_full = 1 if pickup and len(segs) > 1 else 0
    phrase_end = set()
    for j, s in enumerate(segs):
        nxt = segs[j + 1] if j + 1 < len(segs) else None
        if nxt is None or nxt["measure"] != s["measure"]:
            m = metas[s["measure"]]
            if m.get("right") in ("backward", "light-light", "light-heavy") or m.get("ending_stop"):
                phrase_end.add(j)

    def local(j, c):
        s, fam = segs[j], fams[j]
        if c["needs"] is not None and not any(pc == c["needs"] for pc, _, _ in s["notes"]):
            return None
        score = c["prior"]
        for pc, w, long_ in s["notes"]:
            if pc in c["tones"]:
                score += w
            else:
                score -= w * (0.8 if long_ else 0.35)
        tonic = c["name"] in ("I", "i")
        if j == last_sounding:
            score += 2.0 if tonic else 0
        if j == last_sounding - 1:
            score += 0.4 if c["name"] == "V" else 0.2 if c["name"] in ("IV", "iv") else 0
        if j == 0 or j == first_full:
            score += 1.5 if tonic and j == 0 else 1.0 if tonic else 0
        if j in phrase_end and (tonic or c["name"] == "V"):
            score += 0.3
        return score

    # Viterbi over segments, state = (chord, how many segments it has run); a segment with no event
    # to carry a letter keeps the chord before it, and a chord held past two bars starts to cost
    n = len(segs)
    best: list[dict] = [dict() for _ in range(n)]
    for j in range(n):
        for ci, c in enumerate(fams[j].chords):
            sc = local(j, c)
            if sc is None:
                continue
            if j == 0:
                best[j][(ci, 1)] = (sc, None)
                continue
            for (pi, run), (psc, _) in best[j - 1].items():
                pc = fams[j - 1].chords[pi]
                same = pc["sym"] == c["sym"]
                if not same and (segs[j]["ev"] is None or not segs[j]["notes"]):
                    continue  # nowhere to write a letter, or nothing sounding to change for
                if same:
                    held = segs[j]["ev"] is None or not segs[j]["notes"]
                    move = STAY - (0 if held else LONG * max(0, run - RUN_FREE))
                    key = (ci, min(run + 1, RUN_CAP))
                else:
                    move = CHANGE + MOVES.get((pc["name"], c["name"]), 0)
                    key = (ci, 1)
                total = psc + sc + move
                if key not in best[j] or total > best[j][key][0]:
                    best[j][key] = (total, (pi, run))
        if not best[j]:  # nothing allowed (key change under a held note): restart from this segment
            best[j] = {(ci, 1): (0.0, None) for ci in range(len(fams[j].chords))}
    state = max(best[-1], key=lambda k: best[-1][k][0])
    path = [state[0]]
    for j in range(n - 1, 0, -1):
        prev = best[j][state][1]
        state = prev if prev is not None else max(best[j - 1], key=lambda k: best[j - 1][k][0])
        path.append(state[0])
    path.reverse()

    written, last = 0, None
    for j, ci in enumerate(path):
        s, c = segs[j], fams[j].chords[ci]
        ev = s["ev"]
        if ev is None:
            continue
        meta = metas[s["measure"]]
        jump_in = s["first"] and (meta.get("left_repeat") or meta.get("ending") or meta.get("mark"))
        if c["sym"] == last and not jump_in:
            continue
        sym = c["sym"]
        if c["seventh"] is not None and any(pc == c["seventh"] and long_ for pc, _, long_ in s["notes"]):
            sym += "7"  # the melody sings the 7th of V
        ev.chord = sym
        last = c["sym"]
        written += 1
    return written
