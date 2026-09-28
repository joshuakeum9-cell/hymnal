# 새찬송가 Band Hymnal

A free website for a church band: type a hymn number and the music appears, in any key, with the words in Korean, English, or both, the way the bilingual hymnal prints them.

**Live site:** https://joshuakeum9-cell.github.io/hymnal/

- Numbers follow the **새찬송가** (21세기 찬송가, 2006, 645 hymns). The old 통일찬송가 number works too: type it after switching the search to 통일, or open `#/old/46`.
- **Transpose** to any of the 12 keys. "Best fit" keeps the melody in a comfortable range; Lower and Higher choose the octave.
- **Lyrics:** 한/영 shows all the Korean verses, then all the English verses, as the Korean-English hymnal prints them; 한 is Korean only; 영 is English only.
- **Print** one hymn, or a whole **set list** in order, on Letter or A4. Pages break between lines of music.
- Works **offline** once installed (Share, then Add to Home Screen on an iPad or iPhone).

Nothing to pay for: GitHub Pages hosts it, GitHub Actions builds it, everything runs in the browser.

## What is in it today

| | Hymns |
|---|---|
| Listed and searchable (new and old numbers, Korean and English titles) | 645 |
| Music on the site | 457 |
| Held back for copyright (133 Korean-authored, 55 recent or undated) | 188 |
| English words under the notes | 404 |
| English words shown as text below the music | 29 |
| No usable English yet (363 has only a modern translation; the rest have none in the source) | 24 |

Known limits: English placement is automatic and occasionally puts a syllable on the wrong note; the Report a mistake link on each hymn is the way to fix those. Phones in portrait show about one measure per line when both languages are on; turn the phone sideways or pick 한 or 영 for more music per screen.

## How it works

```
data/hymns/405/score.musicxml   notes + Korean lyrics (source of truth, one file per hymn)
data/hymns/405/lyrics.en.txt    English syllables placed on the melody notes (editable text)
data/hymns/405/english.txt      English verses as plain text
data/hymns/405/meta.json        titles, numbers, credits, copyright status
        │
        ▼  tools/build_data.py  (GitHub Actions, every push)
public/hymns/405.<hash>.json    one small file per hymn, fetched when opened (about 4 KB compressed)
src/generated/index.json        search index for all 645 hymns
        │
        ▼  browser
OpenSheetMusicDisplay draws the score as SVG, transposes it, and filters the lyric lines.
```

The site is a Vite + Preact + TypeScript app (`src/`). The data tools are Python (`tools/`).

## Fixing a hymn

Most fixes are one small text edit, and GitHub's web editor is enough.

- **An English syllable on the wrong note:** edit `data/hymns/NNN/lyrics.en.txt`. Each line (`v1:`, `v2:`, `r:` for the refrain) has one token per melody note: a word, a syllable ending in `-` that continues on the next note, `_` to hold the previous syllable, or `.` for no word. Keep the token count the same. Change `# status: proposed` to `# status: reviewed` so the tool never overwrites your fix.
- **A typo in the English text:** add it to `data/english_fixes.json`, then run `python tools/align_english.py NNN`.
- **Wrong English for a hymn:** English is dropped automatically when its first verse does not contain the title's words. To force a decision, list the hymn under `verified_ok` or `exclude` in `data/english_checks.json`.
- **A wrong note or Korean syllable:** edit `data/hymns/NNN/score.musicxml`, or fix the original in MuseScore and re-run the converter for that hymn.

Every push runs `python tools/check_data.py`, which catches token counts that do not match, broken measures, and publishing mistakes, and explains the problem in plain words.

## Rebuilding everything from the sources

```bash
pip install -r tools/requirements.txt
python tools/convert_mscz.py work/ccm4u/mscz data/hymns   # MuseScore files to MusicXML
python tools/build_meta.py                                # titles, numbers, credits, rights
python tools/align_english.py                             # place English syllables on the notes
python tools/check_data.py
npm install
npm run data && npm run dev                               # http://localhost:5173/hymnal/
```

The `work/` folder (not in git) holds the downloaded sources: the seven MuseScore zips from ccm4u.tistory.com, `hymn_mapping.json` and `hymns.json` from rupang21/hymnEngKorean, the key table from praisenworship.biblia66.com, and the credit pages from bibletoppt.com.

## Sources and credit

- **Music and Korean words:** MuseScore transcriptions by **깔끔이 CCM** ([ccm4u.tistory.com](https://ccm4u.tistory.com/)), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Converted to MusicXML with `tools/convert_mscz.py`; corrections are listed in each hymn's `source.json` under `changes` (key signature of 145, lyric typos in 220 and 519).
- **English words:** the original public-domain hymn texts, taken from [rupang21/hymnEngKorean](https://github.com/rupang21/hymnEngKorean), with typo fixes in `data/english_fixes.json`. Hymns whose source had the wrong words use the Korean-English hymnal wording, checked against hymnary.org, in `data/english_overrides/`. Words are split into sung syllables the way hymnals split them (`data/hyphenation.json`, built by `tools/build_hyphenation.py`). Placement on the notes is automatic (`tools/align_english.py`) and improved by hand over time.
- **Titles and 통일찬송가 numbers:** rupang21/hymnEngKorean. **Keys and time signatures:** praisenworship.biblia66.com. **Credits:** bibletoppt.com (AI-assisted there, so they are spot-checked).
- **Fonts:** Noto Sans KR and Noto Serif KR, SIL Open Font License, subset by `tools/subset_fonts.py`.
- **Renderer:** [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/) (BSD-3-Clause).

## Copyright

This is a free tool for one church's band. Hymns written by Korean authors, and hymns whose words or music may still be under copyright, are listed but have no music on the public site (`meta.json` → `publish: false`, with the reason in `rights`). Everything else is a public-domain tune and English text; the Korean translations belong to their rights holders. The gated hymns can be added if 한국찬송가공회 gives written permission.

If you hold rights to anything here and want it removed, please [open an issue](https://github.com/joshuakeum9-cell/hymnal/issues). Each hymn is one folder, so removal takes minutes.

The code is MIT licensed (`LICENSE`). The data in `data/` keeps the terms of its sources above.
