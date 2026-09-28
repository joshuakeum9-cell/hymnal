"""Make small self-hosted Korean web fonts containing only the characters the site uses.

Sources (SIL Open Font License), downloaded once into work/fonts/:
  Noto Sans KR  (screen)   https://github.com/google/fonts/tree/main/ofl/notosanskr
  Noto Serif KR (print)    https://github.com/google/fonts/tree/main/ofl/notoserifkr

Characters: every Hangul syllable in src/generated/hangul.txt (lyrics + titles, written by
build_data.py), every Hangul character in src/**/*.ts(x), plus Latin, punctuation and music-ish symbols.
Outputs public/fonts/*.woff2. Run after build_data.py.
"""
from __future__ import annotations

import glob
import os
import re
import sys
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = {
    "NotoSansKR": "https://github.com/google/fonts/raw/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf",
    "NotoSerifKR": "https://github.com/google/fonts/raw/main/ofl/notoserifkr/NotoSerifKR%5Bwght%5D.ttf",
}
OUTPUTS = [  # (family file, weight, output name)
    ("NotoSansKR", 400, "hymnal-sans-400.woff2"),
    ("NotoSansKR", 700, "hymnal-sans-700.woff2"),
    ("NotoSerifKR", 400, "hymnal-serif-400.woff2"),
    ("NotoSerifKR", 700, "hymnal-serif-700.woff2"),
]


def fetch(name: str) -> str:
    os.makedirs(os.path.join(ROOT, "work/fonts"), exist_ok=True)
    path = os.path.join(ROOT, "work/fonts", name + ".ttf")
    if not os.path.exists(path) or os.path.getsize(path) < 100_000:
        print("downloading", name)
        urllib.request.urlretrieve(SOURCES[name], path)
    return path


def characters() -> str:
    chars = set()
    p = os.path.join(ROOT, "src/generated/hangul.txt")
    if os.path.exists(p):
        chars.update(open(p, encoding="utf-8").read())
    for f in glob.glob(os.path.join(ROOT, "src/**/*.ts*"), recursive=True) + [os.path.join(ROOT, "index.html")]:
        if os.path.exists(f):
            chars.update(re.findall(r"[가-힣ㄱ-ㅎ]", open(f, encoding="utf-8").read()))
    # choseong search letters, Latin, digits, punctuation, quotes, dashes, accidentals
    chars.update("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ")
    chars.update(chr(c) for c in range(0x20, 0x7F))
    chars.update(chr(c) for c in range(0xA0, 0x100))
    chars.update("‘’“”–—…•→←↑↓♭♯♮·")
    return "".join(sorted(chars))


def main() -> None:
    text = characters()
    out_dir = os.path.join(ROOT, "public/fonts")
    os.makedirs(out_dir, exist_ok=True)
    for fam, weight, out in OUTPUTS:
        src = fetch(fam)
        font = TTFont(src)
        if "fvar" in font:
            font = instancer.instantiateVariableFont(font, {"wght": weight})
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["*"]
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        sub = subset.Subsetter(opts)
        sub.populate(text=text)
        sub.subset(font)
        dest = os.path.join(out_dir, out)
        font.flavor = "woff2"
        font.save(dest)
        print(f"{out}: {os.path.getsize(dest) // 1024} KB, {len(text)} characters")


if __name__ == "__main__":
    sys.exit(main())
