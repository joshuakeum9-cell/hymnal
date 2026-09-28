"""Download the Korean-English (한영) hymnal English words from prayertents.com, one page per hymn.

The pages print the English exactly as the Korean-English 새찬송가 does, which is what church bands
hold. Output: work/hanyoung/NNN.json {"n", "ko": [verse text], "en": [verse text]}. Polite: one request
every 8 seconds, backing off when the site says to slow down, pages already fetched are skipped. robots.txt allows these pages.

Usage: python tools/fetch_hanyoung.py [first last]
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "work", "hanyoung")
URL = "https://www.prayertents.com/hymns?nh={n}"
DELAY = 8  # seconds between requests; the site rate-limits faster crawling
HANGUL = re.compile(r"[가-힣]")


def text_lines(page: str) -> list[str]:
    page = re.sub(r"(?is)<script.*?</script>|<style.*?</style>", "", page)
    page = re.sub(r"(?i)<br\s*/?>", "\n", page)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", page))
    return [l.strip() for l in t.split("\n") if l.strip()]


def parse(n: int, page: str) -> dict:
    lines = text_lines(page)
    # the lyrics sit between the "With Lyrics:"/"Share:" markers and the "Hymn" / "Doxology" menu
    try:
        start = lines.index("Share:") + 1
    except ValueError:
        start = 0
    body = []
    for l in lines[start:]:
        if l in ("Hymn", "Doxology") or l.startswith("Hymn Index"):
            break
        body.append(l)
    verses = {"ko": [], "en": []}
    for l in body:
        lang = "ko" if HANGUL.search(l) else "en"
        m = re.match(r"^(\d+)\.\s*(.*)$", l)
        vs = verses[lang]
        if m or not vs:
            vs.append([m.group(2)] if m else [l])
        else:
            vs[-1].append(l)
    ko = [[x for x in v if x] for v in verses["ko"]]
    en = [[x for x in v if x] for v in verses["en"]]
    return {"n": n, "ko": ["\n".join(v) for v in ko], "en": ["\n".join(v) for v in en]}


def main(argv):
    os.makedirs(OUT, exist_ok=True)
    first, last = (int(argv[1]), int(argv[2])) if len(argv) > 2 else (1, 645)
    for n in range(first, last + 1):
        meta = json.load(open(os.path.join(ROOT, f"data/hymns/{n:03d}/meta.json"), encoding="utf-8"))
        if not meta.get("publish"):
            continue  # English for held-back hymns is a modern translation we do not store
        raw = os.path.join(OUT, f"{n:03d}.html")
        if not os.path.exists(raw):
            req = urllib.request.Request(URL.format(n=n), headers={"User-Agent": "Mozilla/5.0 (hymnal band site; one-time fetch)"})
            page = None
            for attempt in range(6):
                try:
                    page = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
                    break
                except Exception as e:  # noqa: BLE001
                    # 429 Too Many Requests: the site asks us to slow down, so wait a few minutes
                    wait = 300 if "429" in str(e) else 20
                    print(n, "failed", e, f"waiting {wait}s", flush=True)
                    time.sleep(wait)
            if page is None:
                continue
            open(raw, "w", encoding="utf-8").write(page)
            time.sleep(DELAY)
        page = open(raw, encoding="utf-8").read()
        rec = parse(n, page)
        json.dump(rec, open(os.path.join(OUT, f"{n:03d}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        if n % 50 == 0:
            print(n, len(rec["ko"]), len(rec["en"]), flush=True)


if __name__ == "__main__":
    main(sys.argv)
