"""Read Open Hymnal ABC files: the soprano notes and the w: lyric syllables under them (public domain source)."""
import re
from fractions import Fraction

NOTE = re.compile(r"(\^\^|\^|__|_|=)?([A-Ga-g])([',]*)(\d*)(/*)(\d*)")
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
KEYS = {"C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7, "F": -1, "Bb": -2, "Eb": -3, "Ab": -4, "Db": -5, "Gb": -6, "Cb": -7}
SHARPS = "FCGDAEB"

def key_acc(k):
    k = k.strip().split()[0] if k.strip() else "C"
    m = re.match(r"([A-G][b#]?)(m|min|dor|mix)?", k)
    tonic, mode = m.group(1), m.group(2)
    f = KEYS.get(tonic, 0)
    if mode in ("m", "min"):
        f -= 3
    acc = {}
    if f > 0:
        for c in SHARPS[:f]: acc[c] = 1
    elif f < 0:
        for c in SHARPS[::-1][:-f]: acc[c] = -1
    return acc

def dur(a, slashes, b, L):
    num = int(a) if a else 1
    if slashes:
        den = int(b) if b else 2 ** len(slashes)
    else:
        den = 1
    return Fraction(num, den) * L

def parse_tune(t):
    L = Fraction(1, 4)
    m = re.search(r"^L:\s*(\d+)/(\d+)", t, re.M)
    if m: L = Fraction(int(m.group(1)), int(m.group(2)))
    km = re.search(r"^K:\s*([^%\n]*)", t, re.M)
    kacc = key_acc(km.group(1) if km else "C")
    notes = []  # dict(midi, dur, tie_from_prev)
    blocks = []  # [start, end, [w lines]]
    lines = t.split("\n")
    cur_voice = None
    block_start = None
    has_repeat = False
    pending = []
    for line in lines:
        mv = re.match(r"^\[V:\s*(\S+)\]", line)
        if mv:
            cur_voice = mv.group(1)
            if cur_voice != "S1V1":
                continue
            body = line[mv.end():]
            body = re.sub(r"\[[A-Z]:[^\]]*\]", "", body)
            body = re.sub(r'"[^"]*"', "", body)
            body = re.sub(r"![^!]*!|\+[^+]*\+", "", body)
            body = re.sub(r"\{[^}]*\}", "", body)
            if re.search(r":\||\|:|\[\d|\|\d", body): has_repeat = True
            block_start = len(notes)
            blocks.append([block_start, None, []])
            bar_acc = {}
            i = 0
            while i < len(body):
                c = body[i]
                if c == "|":
                    bar_acc = {}; i += 1; continue
                if c in "zx":
                    mm = re.match(r"[zx](\d*)(/*)(\d*)", body[i:])
                    notes.append({"rest": True, "dur": dur(mm.group(1), mm.group(2), mm.group(3), L)})
                    i += mm.end(); continue
                if c == "[":
                    # chord: take the first (top in these files) note
                    j = body.index("]", i)
                    inner = body[i+1:j]
                    mm = NOTE.search(inner)
                    rest = re.match(r"(\d*)(/*)(\d*)", body[j+1:])
                    if mm:
                        pitch_only = (mm.group(1) or "") + mm.group(2) + mm.group(3)
                        length = rest.group(0) or (mm.group(4) + mm.group(5) + mm.group(6))
                        body = body[:i] + pitch_only + length + body[j+1+rest.end():]
                        continue
                    i = j + 1; continue
                mm = NOTE.match(body, i)
                if mm:
                    accs, letter, octs, a, sl, b = mm.groups()
                    up = letter.upper()
                    octave = 5 if letter.islower() else 4
                    octave += octs.count("'") - octs.count(",")
                    if accs:
                        alt = {"^": 1, "^^": 2, "_": -1, "__": -2, "=": 0}[accs]
                        bar_acc[(up, octave)] = alt
                    alt = bar_acc.get((up, octave), kacc.get(up, 0))
                    midi = (octave + 1) * 12 + STEP[up] + alt
                    d = dur(a, sl, b, L)
                    tie_prev = bool(notes) and notes[-1].get("tie_next", False)
                    n = {"midi": midi, "dur": d, "tie_prev": tie_prev}
                    i = mm.end()
                    # broken rhythm
                    if i < len(body) and body[i] in "<>":
                        k = 1
                        while i + k < len(body) and body[i+k] == body[i]: k += 1
                        pending.append((len(notes), body[i], k))
                        i += k
                    if i < len(body) and body[i] == "-":
                        n["tie_next"] = True; i += 1
                    notes.append(n)
                    continue
                i += 1
            blocks[-1][1] = len(notes)
            continue
        if line.startswith("w:") and cur_voice == "S1V1" and blocks:
            blocks[-1][2].append(line[2:].strip())
    for idx, k, ch in pending:
        if idx + 1 >= len(notes):
            continue
        a, b = notes[idx], notes[idx + 1]
        f = Fraction(1, 2) ** k
        if ch == ">":
            a["dur"], b["dur"] = a["dur"] * (2 - f), b["dur"] * f
        else:
            a["dur"], b["dur"] = a["dur"] * f, b["dur"] * (2 - f)
    nv = max((len(b[2]) for b in blocks), default=0)
    verses = []
    for v in range(nv):
        seq = []
        for st, en, ws in blocks:
            if not ws:
                continue
            seq.append((st, en, ws[v] if v < len(ws) else (ws[-1] if len(ws) == 1 else None)))
        verses.append(seq)
    return notes, verses, has_repeat

def syllables(wline):
    """ABC w: line -> list of tokens, one per note: ('start', text, continues) or ('hold',) or ('skip',)."""
    wline = re.sub(r"^\s*\d+\.\s*~?", "", wline)
    toks = re.findall(r"\\-|~|[^\s\-_*|~\\]+|-+|_|\*|\||\s+|\\", wline)
    items = []
    word = ""
    for t in toks:
        if t == "~":
            word += " "; continue
        if t.isspace() or t == "|":
            if word: items.append(("start", word.strip(), False)); word = ""
            continue
        if re.fullmatch(r"-+", t):
            if word: items.append(("start", word.strip(), True)); word = ""
            for _ in range(len(t) - 1): items.append(("skip",))
            continue
        if t == "_":
            if word: items.append(("start", word.strip(), False)); word = ""
            items.append(("hold",)); continue
        if t == "*":
            if word: items.append(("start", word.strip(), False)); word = ""
            items.append(("skip",)); continue
        word += "-" if t == "\\-" else t.replace("\\", "")  # \- is a printed hyphen
    if word: items.append(("start", word.strip(), False))
    return items
