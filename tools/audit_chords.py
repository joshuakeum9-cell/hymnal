"""Check the chord letters against the notes, independently of tools/chords.py's own reasoning.

For every beat, take the letter in force (the last <harmony> at or before the beat) and the notes
all voices sound at the beat. Flag a beat when
  bass   the lowest note is not in the chord
  clash  two or more voices sound notes outside the chord
  slash  a slash chord's bass is not the note the bass actually strikes on a downbeat
Beats with a melody alone, a unison line or a rest are not judged. Some flags are real music
(passing notes, suspensions), so compare rates before and after a change rather than aiming at 0.

Usage: python tools/audit_chords.py               (all built hymns, summary)
       python tools/audit_chords.py 405 54        (every flagged beat of these hymns)
       python tools/audit_chords.py --source ...  (run tools/chords.py on data/ instead of public/)
"""
from __future__ import annotations

import glob
import json
import os
import sys
from fractions import Fraction

from lxml import etree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
KIND = {"major": (0, 4, 7), "minor": (0, 3, 7), "diminished": (0, 3, 6), "augmented": (0, 4, 8),
        "suspended-fourth": (0, 5, 7), "dominant": (0, 4, 7, 10), "major-seventh": (0, 4, 7, 11),
        "minor-seventh": (0, 3, 7, 10), "half-diminished": (0, 3, 6, 10), "diminished-seventh": (0, 3, 6, 9)}
TEXT = {"major": "", "minor": "m", "dominant": "7", "diminished": "dim", "augmented": "+", "suspended-fourth": "sus4",
        "major-seventh": "maj7", "minor-seventh": "m7", "half-diminished": "m7b5", "diminished-seventh": "dim7"}


def walk(root):
    """Notes (start, end, midi, staff, voice), harmonies (time, root pc, kind, bass pc) and beats."""
    notes, harms, beats = [], [], []
    div, bt, t0 = 1, (4, 4), Fraction(0)
    for m in root.iter("measure"):
        a = m.find("attributes")
        if a is not None:
            if a.findtext("divisions"):
                div = int(a.findtext("divisions"))
            ts = a.find("time")
            if ts is not None and ts.findtext("beats"):
                try:
                    bt = (int(ts.findtext("beats").split("+")[0]), int(ts.findtext("beat-type")))
                except ValueError:
                    pass
        pos = longest = last = Fraction(0)
        for el in m:
            if el.tag == "backup":
                pos -= Fraction(int(el.findtext("duration")), div)
            elif el.tag == "forward":
                pos += Fraction(int(el.findtext("duration")), div)
                longest = max(longest, pos)
            elif el.tag == "harmony":
                rs, ra = el.findtext("root/root-step"), int(el.findtext("root/root-alter") or 0)
                bs = el.findtext("bass/bass-step")
                bpc = (STEP[bs] + int(el.findtext("bass/bass-alter") or 0)) % 12 if bs else None
                harms.append((t0 + pos, (STEP[rs] + ra) % 12, el.findtext("kind"), bpc))
            elif el.tag == "note" and el.find("grace") is None:
                d = Fraction(int(el.findtext("duration") or 0), div)
                chord = el.find("chord") is not None
                st = last if chord else pos
                p = el.find("pitch")
                if p is not None and el.find("rest") is None:
                    midi = (int(p.findtext("octave")) + 1) * 12 + STEP[p.findtext("step")] + int(float(p.findtext("alter") or 0))
                    notes.append((t0 + st, t0 + st + d, midi, el.findtext("staff") or "1", el.findtext("voice") or "1"))
                if not chord:
                    last = pos
                    pos += d
                    longest = max(longest, pos)
        beat = Fraction(3, 2) if (bt[1] == 8 and bt[0] % 3 == 0) else Fraction(2) if bt[1] == 2 else Fraction(1)
        length = longest or Fraction(bt[0] * 4, bt[1])
        t = Fraction(0)
        while t < length - Fraction(1, 64):
            beats.append((t0 + t, m.get("number"), t == 0))
            t += beat
        t0 += length
    harms.sort(key=lambda h: h[0])
    return notes, harms, beats


def audit(root):
    """(beats judged, [(time, bar, flag, letter, sounding)], letters)"""
    notes, harms, beats = walk(root)
    out, hi, judged = [], -1, 0
    for t, bar, downbeat in beats:
        while hi + 1 < len(harms) and harms[hi + 1][0] <= t:
            hi += 1
        sounding = [x for x in notes if x[0] <= t < x[1]]
        if len({(s[3], s[4]) for s in sounding}) < 3 or len({s[2] % 12 for s in sounding}) < 2 or hi < 0:
            continue
        judged += 1
        _, r, k, b = harms[hi]
        tones = {(r + i) % 12 for i in KIND[k]}
        bass = min(sounding, key=lambda s: s[2])
        letter = NAMES[r] + TEXT[k] + ("/" + NAMES[b] if b is not None else "")
        pcs = " ".join(sorted({NAMES[s[2] % 12] for s in sounding}, key=NAMES.index))
        if bass[2] % 12 not in tones:
            out.append((t, bar, "bass", letter, f"{pcs} (bass {NAMES[bass[2] % 12]})"))
        elif b is not None and bass[2] % 12 != b and bass[0] == t and downbeat:
            out.append((t, bar, "slash", letter, f"{pcs} (bass {NAMES[bass[2] % 12]})"))
        elif sum(1 for s in sounding if s[2] % 12 not in tones) >= 2:
            out.append((t, bar, "clash", letter, pcs))
    return judged, out, len(harms)


def load(n: int, source: bool):
    if source:
        sys.path.insert(0, os.path.join(ROOT, "tools"))
        import chords
        root = etree.parse(os.path.join(ROOT, f"data/hymns/{n:03d}/score.musicxml")).getroot()
        chords.add_chords(root)
        return root
    xml = json.load(open(os.path.join(ROOT, f"public/hymns/{n:03d}.json"), encoding="utf-8"))["xml"]
    return etree.fromstring(xml.encode("utf-8"))


def main(argv):
    source = "--source" in argv
    ns = [int(a) for a in argv[1:] if a.isdigit()]
    if ns:
        for n in ns:
            judged, flags, letters = audit(load(n, source))
            print(f"{n}: {len(flags)} of {judged} beats flagged, {letters} chord letters")
            for t, bar, flag, letter, pcs in flags:
                print(f"   bar {bar} beat at {float(t):g}: {flag:5} {letter:8} sounding {pcs}")
        return 0
    pattern = "data/hymns/*" if source else "public/hymns/*.json"
    all_ns = sorted(int(os.path.basename(p)[:3]) for p in glob.glob(os.path.join(ROOT, pattern)))
    totals = {"bass": 0, "clash": 0, "slash": 0}
    judged_all = letters_all = 0
    worst = []
    for n in all_ns:
        judged, flags, letters = audit(load(n, source))
        judged_all += judged
        letters_all += letters
        for f in flags:
            totals[f[2]] += 1
        worst.append((len(flags) / max(judged, 1), n, len(flags), judged))
    worst.sort(reverse=True)
    flagged = sum(totals.values())
    print(f"{len(all_ns)} hymns, {judged_all} beats judged, {flagged} flagged ({100 * flagged / max(judged_all, 1):.1f}%): {totals}")
    print(f"{letters_all} chord letters ({letters_all / max(judged_all, 1):.2f} per judged beat)")
    print("most flagged:", ", ".join(f"{n} {k}/{j}" for _, n, k, j in worst[:20]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
