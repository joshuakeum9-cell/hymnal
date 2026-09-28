"""Build data/hyphenation.json: how hymnals split English words into sung syllables.

Learned from the hyphenated English in rupang21/hymnEngKorean hymns.json (e.g. "fel-low-ship"),
so words in unhyphenated English (overrides, Korean-English hymnal text) split the same way.
The most common split wins when the source disagrees with itself.
"""
from __future__ import annotations

import collections
import json
import os
import re

# poetic -ed endings sung as their own syllable in hymns
SUNG_ED = {"blessed", "beloved", "accursed", "wicked", "crooked", "wretched", "cursed", "learned", "aged", "belovèd"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def silent_ending(word: str, split: str) -> bool:
    """'open-ed', 'ski-es': an ending cut off as its own syllable though it is not sung that way."""
    if word in SUNG_ED:
        return False
    if split.endswith("-ed"):
        return not word.endswith(("ted", "ded"))
    if split.endswith("-es"):
        return not word.endswith(("ses", "xes", "zes", "ches", "shes", "ces", "ges"))
    return False


def main():
    hymns = json.load(open(os.path.join(ROOT, "work/meta/hymns.json"), encoding="utf-8"))
    seen: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for h in hymns:
        for v in h.get("lyrics", []):
            for line in v.get("lines", []):
                for w in (line.get("en") or "").replace("’", "'").split():
                    core = re.sub(r"^[^A-Za-z']+|[^A-Za-z'-]+$", "", w)
                    if "-" not in core.strip("-") or not re.fullmatch(r"[A-Za-z']+(-[A-Za-z']+)+", core):
                        continue
                    seen[core.replace("-", "").lower()][core.lower()] += 1
    import pronouncing  # CMU dictionary
    out, dropped = {}, []
    for k, c in sorted(seen.items()):
        if len(k) <= 2:
            continue
        # prefer a split whose syllable count the dictionary knows ("lov-ed" is a typo, "bless-ed" is sung)
        counts = {pronouncing.syllable_count(p) for p in pronouncing.phones_for_word(k.replace("'", ""))}
        good = [(n, h) for h, n in c.items() if (not counts or h.count("-") + 1 in counts or k in SUNG_ED) and not silent_ending(k, h)]
        if good:
            out[k] = max(good)[1]
        else:
            dropped.append(c.most_common(1)[0][0])
    json.dump(out, open(os.path.join(ROOT, "data/hyphenation.json"), "w", encoding="utf-8", newline="\n"),
              ensure_ascii=False, indent=0, sort_keys=True)
    print(len(out), "words; dropped", len(dropped), "splits the dictionary disagrees with, e.g.", dropped[:12])


if __name__ == "__main__":
    main()
