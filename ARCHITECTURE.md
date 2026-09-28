# 새찬송가 Band Hymnal: Final Architecture

Design only; nothing is built until this is approved. It is the data-first design plus the judges' best ideas from the other two, with the verifiers' corrections applied.

## 1. Goal and non-goals

**Goal.** A free, static, unlisted website on GitHub Pages where a band member types a hymn number and sees that hymn as a standard hymnal page (grand staff, closed-score SATB, lyrics between the staves), transposable to any of the 12 keys, with lyrics as Korean + English, Korean only, or English only, printable to Letter paper. Speed, honestly: sub-second for any view the phone has rendered before; under one second for a fresh render only with shell, engine, font and hymn already cached (section 6).

**Non-goals for v1.** Accounts, servers, audio, chord symbols, instrument parts, scans of publisher pages, re-engraving from scratch, pixel-parity with the printed book.

## 2. Edition lock and the acceptance test

**Edition.** The 21세기 찬송가, commonly 새찬송가, published by 한국찬송가공회 in 2006, 645 hymns (https://ko.wikipedia.org/wiki/21%EC%84%B8%EA%B8%B0_%EC%B0%AC%EC%86%A1%EA%B0%80); the 아가페 and 생명의말씀사 bilingual editions use the same numbering (https://m.yes24.com/Goods/Detail/110329445).

**Why this edition.** Checkpoints 405 and 300 match it exactly. The third does not: in the 새찬송가, 46 is 이 날은 주님 정하신, and 찬양하라 복되신 구세주 예수 / Praise Him, Praise Him is 31; "46" is its number in the 1983 통일찬송가 (https://www.prayertents.com/hymns?nh=46). Every symbolic source uses the 645 numbering, so the dataset does too, with the 통일찬송가 number stored per hymn as a searchable alias from a one-to-one mapping (645 rows, 164 blank old numbers, https://raw.githubusercontent.com/rupang21/hymnEngKorean/main/data/hymn_mapping.json).

**Acceptance table** (`data/acceptance.csv`), each row from two independent sources (Han Wiki concordance, https://wiki.michaelhan.net/%EA%B5%AC%EC%B0%AC%EC%86%A1%EA%B0%80_%EC%83%88%EC%B0%AC%EC%86%A1%EA%B0%80_%EB%AA%A9%EB%A1%9D, and https://praisenworship.biblia66.com/15 for keys and times, which agrees 645/645 with the ccm4u catalog).

| 새 no. | 통 no. | Korean title | English title | Key, time |
|---|---|---|---|---|
| 31 | 46 | 찬양하라 복되신 구세주 예수 | Praise Him, Praise Him | Ab 6/8 |
| 46 | 58 | 이 날은 주님 정하신 | This Is the Day the Lord Hath Made | G 3/2 |
| 300 | 406 | 내 맘이 낙심되며 | Just When I Am Disheartened | Bb 6/8 |
| 404 | 477 | 바다에 놀이 일 때에 | Fierce Raged the Tempest O'er the Deep | Cm 3/4 |
| 405 | 458 | 주의 친절한 팔에 안기세 | What a Fellowship, What a Joy Divine | Ab 4/4 |
| 438 | unverified | 내 영혼이 은총 입어 | unverified | Ab 3/4 |
| 645 | (none) | 아멘 | Amen | D 4/4 |

The 438 row came from the sources with a blank old number and no English title, which looks like a data gap rather than a fact (the hymn was in the 통일찬송가); confirm both cells against the printed book before the row becomes a CI rule.

**Spot-check rule.** CI fails if the rebuilt index disagrees with any row; every hymn a band member confirms against the book becomes a new row; quarterly the maintainer re-checks 5 percent of published hymns.

## 3. System overview

**Runtime.** A Vite app with a hash router (the part of the URL after `#`, which the server never sees): number box → in-memory index → hymn id → fetch `hymns/405.<hash>.xml` (service worker cache) → DOM lyric filter (ko / en / both) → `osmd.load(doc)` → `Sheet.Transpose = delta` → render SVG → Latin font pass → SVG cache (memory + IndexedDB) → print CSS. GitHub Pages serves the built files over HTTPS and HTTP/2 with gzip on the fly; GitHub Actions builds them on every push (section 10) from the data pipeline (section 11).

**What happens when someone types "405".** On a repeat visit the shell, engine, font and index are already in the service worker cache (a script the browser keeps so it can serve cached files, even offline). "405" cannot be extended to another valid number, so the hymn opens without Enter: the URL becomes `#/405`, the app fetches `hymns/405.9f3c1a.xml`, keeps every lyric line (default mode "both"), hands the Document to `osmd.load`, sets `osmd.Sheet.Transpose = 0` and renders SVG. (`osmd.TransposeCalculator = new TransposeCalculator()` was assigned once at engine load; without it `Sheet.Transpose` does nothing.) Tapping "F" computes the delta (-3), reloads the kept untransposed Document, sets `Sheet.Transpose = -3` before that load's first render, renders, sets `#/405?key=F` and the header "Ab → F (down 3), soprano top Eb5 → C5", and caches the SVG.

## 4. Repository layout (single repo, `hymnal`)

```
hymnal/
  README.md, ATTRIBUTION.md, TAKEDOWN.md, LICENSE-code (MIT), LICENSE-data (CC BY 4.0)
  data/hymns/405/
    score.musicxml     canonical MusicXML 4.0: notes + Korean lyrics (source of truth)
    lyrics.ko.txt      Korean verses as running text with word spaces (generated, CI-checked)
    lyrics.en.txt      English syllables per verse, volunteer-editable
    meta.yaml          titles, numbers, credits, layered rights, provenance, review log
  data/overrides/hyphenation.yaml, data/sources/ (manifests only), data/acceptance.csv
  work/ (git-ignored zips and exports), tools/ (tsx scripts, tools/py/), src/ (Vite 8 + Preact 10 + TypeScript)
  vendor/ (opensheetmusicdisplay 2.1.3 pinned, musicxml-4.0 XSD), tests/, .github/workflows/
```

A volunteer only ever edits `lyrics.en.txt`; every script has an `npm run` alias.

## 5. Data model

**Source of truth: canonical uncompressed MusicXML 4.0 per hymn, plus two plain-text lyric files and a small YAML file.** Rejected: `.mscz` and `.mxl` (undiffable; MuseScore 4.7.5 never writes `xml:lang`, https://github.com/musescore/MuseScore/blob/v4.7.5/src/importexport/musicxml/internal/export/exportmusicxml.cpp), ABC (loses two-voice SATB; five open abcjs transposition bugs, https://github.com/paulrosen/abcjs/issues/1145), MEI (Verovio-only). The ccm4u files carry Korean lyrics one Hangul syllable per note (pozafly's audit: two typos in 81 to 645, three variants in 1 to 80 matching printed pages, https://raw.githubusercontent.com/pozafly/hymn-transpose/main/docs/score-quality-audit.md); English needs hyphenation and melisma decisions a band member must fix without touching XML, so it is a text file merged at build time.

**score.musicxml conventions.** One `<part>` with two staves. MuseScore numbers voices across the whole part (`voice = (staff - 1) x 4 + voice + 1` in `exportmusicxml.cpp`), so staff 1 carries voices 1 to 4 and staff 2 carries 5 to 8. Expected shape: soprano and alto as voices 1 and 2 on staff 1 (or as two-note chords in voice 1), tenor and bass as voices 5 and 6 on staff 2, voice 7 where the documented fixes needed a third voice (133, 244); the soprano note is the highest note of voice 1 on staff 1. Nobody has opened all 645 files, so the day-one audit tabulates parts, staves, voices, chords and lyric-bearing notes per file and writes the final rule; the importer normalizes mechanically (merges split parts, accepts either soprano/alto shape), and only what it cannot normalize is hand-fixed in MuseScore (budgeted in section 11). `<key><fifths>` and `<time>` in measure 1; no `<transpose>`. Korean lyrics sit on the soprano voice as `<text xml:lang="ko">`, one NFC-normalized Hangul code point per note (NFC: one code point per syllable, https://www.unicode.org/faq/korean.html); MusicXML 4.0 puts `xml:lang` on `<text>`, never on `<lyric>` (https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/lyric-language/).

**Slots, verses and refrain.** A slot is every singable soprano note (tie continuations excluded), so English can place a syllable where the Korean line holds a note. With two or more verses, refrain slots are the notes carrying Korean lyric 1 but not lyric 2; a slot with no Korean syllable inherits the region of the slot before it. When English needs a note the Korean setting tied together (rare), that is a MuseScore edit recorded in `sources.notes.changes`; the pilot counts them.

**lyrics.en.txt format.** Space-separated tokens; a trailing `-` continues the word into the next slot; a bare `_` holds the slot for the previous syllable (melisma, exported as `<extend>`); `v1:` to `vN:` lines plus one optional `r:` refrain line; `?` marks a doubtful token. CI: each verse's token count equals the verse slot count and the `r:` count equals the refrain slot count. At build time `merge-lyrics` inserts the refrain into every English verse, renumbers Korean verse n to lyric number 2n-1 and inserts English verse n as 2n; both engines stack verses in number order between the staves (spike-verified), which gives the Korean-over-English pairing. Missing English verses render Korean only.

**lyrics.ko.txt.** Korean verses as running text with word spaces, generated from 깔끔이's CC BY TXT lyric set (post dated 2022-04-16 on https://ccm4u.tistory.com/); CI strips the spaces and asserts the syllables equal the score's in order. It supplies overflow verses for print (section 9) and word boundaries for `word-break: keep-all`.

**meta.yaml.** Required: `number, title_ko, title_en, key, time, verses, refrain, rights (three layers), sources.notes, status`; credits and tune names are optional (tune names exist on only 18 of 428 bibletoppt pages).

```yaml
number: 405   old_number: 458        # null for 2006 additions
title_ko: 주의 친절한 팔에 안기세
title_en: What a Fellowship, What a Joy Divine
rights:
  tune:    {status: pd_verified, basis: "Hymnary people export: Showalter d.1924; SHOWALTER 1887"}
  text_en: {status: pd_verified, basis: "Hymnary people export: Hoffman d.1929; text 1887"}
  text_ko: {status: claimed, era: 1931, revised_2006: unknown, basis: "1931 신정찬송가 translation"}
sources: {notes: {origin: ccm4u, sha256: "...", changes: []}}
status: published      # draft | reviewed | published
checked_against_book: true
```

Status: `draft` (imported, unchecked); `reviewed` (notes, key, time and Korean verse count verified against biblia66; ships Korean-only); `published` (English present and `checked_against_book: true`).

**index.json**, generated from all meta.yaml files: numbers, titles, first lines, a 초성 string precomputed with es-hangul `getChoseong` (https://github.com/toss/es-hangul), key, mode, `en_verses`, rights and file name; about 350 bytes per row, 35 to 45 KB gzipped; gated hymns keep a row with `file: null`. Vite imports it, so the built file is content-hashed (its name carries a fingerprint of its contents) and precached with the shell.

**Naming and sizes.** Built files are `hymns/405.9f3c1a.xml` (six hex characters of the SHA-256). The `.xml` extension is load-bearing: Pages gzips `.xml` (`application/xml`) on the fly but serves `.musicxml` (`application/vnd.recordare.musicxml+xml`) uncompressed; the verifiers measured 167,880 bytes on the wire for a `.musicxml` versus 6,206 for a gzipped `.xml` on one github.io host (https://opensheetmusicdisplay.github.io/demo/Land_der_Berge.musicxml). Raw files are 150 to 300 KB (100 to 190 MB in total, inside the 1 GB Pages limit, https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits); over the wire 6 to 8 KB each, about 5 MB for all 645.

## 6. Rendering and transposition in the browser

**Engine: OpenSheetMusicDisplay 2.1.3 (BSD-3), pinned and vendored.** It measures Hangul with the browser's real font through canvas `measureText` (https://raw.githubusercontent.com/opensheetmusicdisplay/opensheetmusicdisplay/develop/src/MusicalScore/Graphical/VexFlow/VexFlowTextMeasurer.ts); the spike's six-lyric-line hymn rendered at 377 px with zero overlaps across 180 adjacent Hangul pairs. TransposeCalculator is in the public bundle (https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@2.1.3/build/opensheetmusicdisplay.min.js), 1.33 MB raw, 335 KB gzip -9; Pages compresses less, so budget 340 to 400 KB.

**Fallback: Verovio 6.3.0 (LGPL).** Its transposer takes a named target key (https://book.verovio.org/advanced-topics/transposition.html), but it costs about 2.6 MB gzipped on Pages, reloads on every key change, and measures text against Times tables of 185 glyphs, using the "o" glyph at 0.50 em for every Hangul syllable that really advances 1.00 em (https://github.com/rism-digital/verovio/issues/4130). If the flag flips, `sheet.ts` changes and so does the PWA config: Workbox silently drops files over 2 MiB from the precache manifest, so `maximumFileSizeToCacheInBytes` rises to 8 MiB (https://developer.chrome.com/docs/workbox/reference/workbox-build/).

**Fonts.** Before the first render the app awaits `document.fonts.load('16px "Noto Sans KR"')` on the self-hosted subset so `measureText` uses the real font. OSMD has one `defaultFontFamily`, so a post-render pass gives Latin `<text>` nodes a Times-family serif; serif Latin is narrower than Hangul at the same size, and the CI overlap test confirms no collisions.

**Three lyric modes.** Before `osmd.load`, parse the MusicXML with DOMParser; for `ko` remove every `<lyric>` whose `<text>` has `xml:lang="en"` (or even `number` parity if the attribute is missing), for `en` the reverse, for `both` nothing; renumber survivors 1..n so verse 1 sits on top. When `en_verses` is 0 the `en` chip is disabled with "English not yet available".

**Transposition.** The original tonic comes from `<key><fifths>` and `<mode>` through tonal's `Key.majorTonicFromKeySignature` (relative minor for minor hymns such as 404; https://raw.githubusercontent.com/tonaljs/tonal/main/packages/key/README.md). The semitone delta is folded into -6..+5: at a tie (|delta| = 6), or when going up would push the soprano's top note above F5, go down; otherwise take the shorter direction. The header shows "Ab → F (down 3), soprano top Eb5 → C5", with an up/down link. Beside the 12 chips sit an "Original" chip and +1 / -1 semitone buttons; for a minor-mode hymn the chips carry minor tonics (Cm, C#m, Dm ...) and the header reads "Cm → Fm (up 5)". OSMD cannot tell F# from Gb and has no double accidentals, so one chip is F#/Gb and the CI smoke render catches ugly spellings.

Every key change runs the sequence the OSMD wiki calls safe: `osmd.load(cachedDocument)`, then `osmd.Sheet.Transpose = delta`, then `osmd.render()`, always from the kept untransposed Document. The wiki warns that a second transposition after load and render, to keys like F# or B, occasionally misbehaves and that a clean reload with Transpose set before the first render avoids it (https://github.com/opensheetmusicdisplay/opensheetmusicdisplay/wiki/Transposing); `updateGraphic()` on a rendered sheet is exactly that path, so it is not the default. It stays an optimization, enabled only if the CI chain test (original → F#/Gb → B → Db → original on 31, 46, 300 and 405, final SVG equal to a fresh render) passes on 2.1.3, where the January 2026 spelling fixes landed (https://github.com/opensheetmusicdisplay/opensheetmusicdisplay/issues/1345).

**Render caching.** Rendered SVG strings live in a session `Map` and in IndexedDB (via idb-keyval, a 0.8 KB helper) keyed by `hymn|fileHash|key|mode|pageFormat|osmdVersion|containerWidth`; a hit skips OSMD entirely, `autoResize` is off while a cached SVG is shown, and the file hash means a lyric correction invalidates old renders everywhere. Only one hymn's SVG is in the DOM at a time (iOS pages get roughly 300 to 450 MB, https://www.catchmetrics.io/blog/deep-dive-ram-internals-webkit). On idle it pre-renders the other two lyric modes and the two likeliest keys. Dark stage mode is CSS on the SVG; print forces black on white.

**Timing budget.** Desktop was measured in the spike (12 cores, Chrome 152); the phone column is a 3 to 6x inference that Phase 0 replaces with measurements at 4x CPU throttling (Lighthouse's 4x matches a Moto G4-class phone) on a named mid-range Android and an older iPad, recording device and browser version.

| Step | Desktop measured | Phone budget |
|---|---|---|
| OSMD chunk parse (once per session, started on idle) | 25 to 44 ms | under 250 ms |
| DOM filter + osmd.load | 86 ms | under 350 ms |
| render | 124 ms | under 500 ms |
| First render, Enter to SVG visible, everything cached and engine parsed | about 210 ms | under 1 s |
| Key or mode change, reload path (load + render), uncached | 100 to 200 ms | under 1 s |
| Key change, updateGraphic path (optimization only) | 51 to 75 ms | under 450 ms |
| SVG cache hit | under 10 ms | under 50 ms |

Plainly: the sub-second target is met for cached views and budgeted at the limit for uncached ones, measured on a synthetic 16-bar hymn. If the named phone misses 1 s, the snapshot gate in section 8 fires, and OSMD 2.0's incremental `renderNext` (one system at a time) is the second escape hatch.

## 7. Search and navigation

- **Number entry.** One box, `type="text" inputmode="numeric" pattern="[0-9]*"`, for the phone digit keypad (https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/inputmode). Lookup runs on every keystroke; when the typed number cannot be extended within 1 to 645 (any three digits, or two digits 65 to 99) the hymn opens without Enter. A "새 / 통" toggle, or typing "통46", switches to 통일찬송가 numbers; the header prints both.
- **Title search.** When the first character is not a digit, plain `includes()` over lowercased titles, first lines, tune and the precomputed 초성 field, so "ㅈㅇㅊㅈ" matches "주의 친절한".
- **URL state.** Hash routing, because Pages returns a real 404 for unknown paths (https://github.com/rafgraph/spa-github-pages): `#/405`, `#/405?key=F&lyrics=ko`, `#/old/46` (resolves to 31), `#/set?h=405:F,300:C,31:Ab&lyrics=both`, `#/review/405`.
- **Previous / next and pedals.** Arrow buttons step through the numbering and prefetch neighbours; PageDown, PageUp, Right and Left (what Bluetooth page-turn pedals emit) map to next and previous.

## 8. Performance and offline

- **Budget** on Lighthouse slow 4G (1.6 Mbps, 150 ms RTT, 4x CPU, https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md): app shell under 50 KB gzipped excluding OSMD; OSMD chunk 340 to 400 KB (Pages has gzip only, no brotli, https://github.com/orgs/community/discussions/21655); font subset 150 to 250 KB. Network targets: first hymn in 5 s cold on slow 4G, 2.5 s on typical 4G, under 1 s on repeat visits.
- **Prefetch.** Only the index loads up front; the engine loads on idle; after a render N-1, N+1 and the set list are prefetched over the same HTTP/2 connection (one connection for many small files; verified, https://joshuakeum9-cell.github.io/supplyweave/).
- **Compression.** Built hymn files are `.xml` so Pages gzips them (section 5); Phase 0 curls one deployed hymn and a post-deploy CI step asserts `Content-Encoding: gzip`, so a rename cannot silently reintroduce the 25x penalty.
- **Service worker.** vite-plugin-pwa 1.3.0 with Workbox 7.4.1: precache the shell, the OSMD chunk, the font subset and the content-hashed index; `NetworkFirst` for `index.html`; `CacheFirst` with an ExpirationPlugin only for the hashed `hymns/*` files (a `CacheFirst` index would keep pointing at hymn hashes that vanish on redeploy); Vite `base: '/hymnal/'` sets the scope (https://vite-pwa-org.netlify.app/guide/pwa-minimal-requirements). A two-build Playwright test proves a stale client picks up a changed hymn. A "Download all" button caches every published hymn with a progress bar: about 5 MB, under 6 MB with engine and font.
- **Original-key snapshots** (decision gate, not default). If first render exceeds 1 s on the named phone, a build job renders each hymn's original key to SVG in the same Playwright Chromium the smoke test uses, with the font subset loaded (bare Node lacks the real canvas and font OSMD measures with), and the app shows it until the engine is ready.
- **iPad Safari.** No install prompt; use Share → Add to Home Screen. The installed app is exempt from the 7-day script-storage deletion and has storage separate from the Safari tab, so "Download all" must run inside it (https://webkit.org/blog/14403/updates-to-storage-policy/); Screen Wake Lock works there from iPadOS 18.4 (https://webkit.org/blog/16574/webkit-features-in-safari-18-4/).

## 9. Print and set list

- **Print CSS and pages.** `@media print` hides the UI; `@page { size: letter; margin: 0.5in }`, Baseline since December 2024 per MDN (https://developer.mozilla.org/en-US/docs/Web/CSS/@page), with an A4 toggle; no viewport units in print styles. On Print the app re-renders with `pageFormat: 'Letter_P'` (or `A4_P`) so each page is its own fixed-size SVG with `break-after: page` and `break-inside: avoid`.
- **Layout rules.** A header carries both numbers, both titles, tune, meter, key and any transposition. Up to six lyric lines sit between the staves (three verses in "both" mode, six in one language); further verses print as text below the score from `lyrics.ko.txt` and `lyrics.en.txt`, Korean line then English line. Whether the printed book does this is known only from the user's photo, so Decision 1 asks for a four-verse page. `word-break: keep-all` is scoped to `:lang(ko)` (https://developer.mozilla.org/en-US/docs/Web/CSS/word-break).
- **Korean font embedding.** Browsers embed the page's web fonts in the printed PDF, so the self-hosted Noto Sans KR subset prints correctly offline. `subset_font.py` (pyftsubset) takes the union of every lyric syllable, index title and Korean UI string, roughly 1,500 to 2,000 glyphs, and CI asserts every Hangul code point in `dist/` is covered. No jsPDF (155 KB plus a multi-megabyte Korean TTF, https://github.com/yWorks/svg2pdf.js); "Save as PDF" is the print dialog.
- **Weekly set list.** Pick hymns with a key and lyric mode each, reorder, share the `#/set?...` URL; "Print set" renders each hymn off-screen and prints them in order with one page break per hymn; the last set list is kept in `localStorage`.

## 10. Build and deploy

- **Tooling.** Vite 8 + Preact 10 + TypeScript for the app and tsx for every script, so the maintainer keeps one language; Python only for `propose_en.py` (pyphen 0.18.1 plus pronouncing 0.3.0, https://pyphen.org/) and `subset_font.py` (fonttools). MuseScore export runs on the maintainer's Windows machine (headless Linux is unverified).
- **data-ci.yml (every PR touching `data/`).** (1) `xmllint` against the vendored MusicXML 4.0 XSD with its two `xs:import` lines patched to local copies, about 0.04 s per file (https://blog.karimratib.me/2020/11/17/validate-musicxml.html). (2) Structure: one part, two staves, every note carries `<staff>`, staff 1 voices in 1..4 and staff 2 in 5..8, at most three voices per staff, key and time in measure 1, every measure complete per voice, no `<transpose>`, lyric numbers contiguous from 1, every `<text>` has `xml:lang`. (3) Alignment: English token counts equal slot counts, unknown words flagged, `lyrics.ko.txt` syllables equal the score's; messages are written for humans. (4) `acceptance.csv` against the rebuilt index. (5) Rights gate: `reviewed` requires all three rights layers; `published` also requires `checked_against_book: true`; gated hymns never reach `dist/` unless `CHURCH_ONLY=1`. (6) Playwright smoke render of changed hymns in the original key and in C, Db, E, F#/Gb and B, failing on console errors, more than six accidentals in a key signature, any double accidental, or adjacent Hangul syllables whose `getBBox` rectangles (the browser's measured box around each syllable) overlap at 377 or 840 px; plus the chain test from section 6. (7) SVG snapshot diff for 31, 46, 300 and 405 in the same Chromium with the font subset loaded.
- **deploy.yml (push to main).** Data checks → `merge-lyrics` and `build-index` → `subset_font.py` → `vite build` → assert the precache manifest contains the engine chunk and the index → `actions/upload-pages-artifact@v4` → `actions/deploy-pages@v4` with `permissions: pages: write, id-token: write` (https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) → curl one deployed hymn and assert `Content-Encoding: gzip`. Pages settings: public repository (the free plan publishes only public repos), Source: GitHub Actions, HTTPS enforced, `noindex`, no sitemap.

## 11. Data production pipeline

**Layers and sources.**

- **Notes, harmony, Korean lyrics (closed-score SATB):** 깔끔이's MuseScore set, 645 .mscz in seven zips, password ccm4u, CC BY 4.0 on every post via Tistory's CCL block; "all rights reserved" is only the skin footer (https://ccm4u.tistory.com/entry/%EC%83%88%EC%B0%AC%EC%86%A1%EA%B0%80-401%EC%9E%A5500%EC%9E%A5-%EB%AE%A4%EC%A6%88%EC%8A%A4%EC%BD%94%EC%96%B4-musescore-%ED%8C%8C%EC%9D%BC). Automated after six hand fixes.
- **Korean running text:** 깔끔이's TXT lyric set (2022-04-16), CC BY 4.0 as a transcription; the text itself is claimed by the 공회. Automated, CI-checked.
- **Pitch cross-check:** nmcat NWC set, 645 files, open score, CC BY 4.0 (https://nmcat.tistory.com/93). Unverified tooling: NWCtxt export needs a paid NoteWorthy licence and mzealey/nwc2xml is unmaintained (https://github.com/musescore/nwc2musicxml); try 20 files in Phase 2, drop the step if it fails.
- **English lyrics:** public-domain Hymnary texts for Western hymns (https://hymnary.org/text/what_a_fellowship_what_a_joy_divine), rupang21 `hymns.json` as a verse-pairing check (https://github.com/rupang21/hymnEngKorean); a script proposes, a human reviews. Korean-composed hymns have English only in the printed bilingual book: gated until permission.
- **Metadata:** rupang21 `hymn_mapping.json` for titles and old numbers; biblia66 for key, time and theme; bibletoppt credits, AI-assisted and sometimes marked ai-draft, so spot-checked (https://bibletoppt.com/hymn/sheet-music/405); Hymnary CSV exports with field-qualified queries for tune names and death years (https://hymnary.org/people?qu=in%3Apeople%20personName%3A%22Showalter%22&export=csv&limit=8).

**Tool chain (maintainer, once for the notes layer).**

1. Download the seven zips in a browser, `7z x -pccm4u` into `work/ccm4u/`; record each file's SHA-256 in `data/sources/`.
2. In MuseScore 4.7.5 fix 112 and 451 (staff transposition to 0), 133 and 244 (overlapping lower-staff notes to voice 3), 220 (1절 복을 받아 → 본을 받아) and 519 (4절 두르려 → 두드려); record each in `sources.notes.changes` (https://raw.githubusercontent.com/pozafly/hymn-transpose/main/docs/source-audit-645.md); re-check 22, 42 and 63 against the book.
3. `MuseScore4.exe -j work/jobs.json` with 645 `{in, out}` pairs, absolute paths (https://handbook.musescore.org/appendix/command-line-usage).
4. `npm run audit`, then `npm run import -- --all`: normalize (merge split parts, keep MuseScore's voice numbers, strip `<transpose>`, add `lyric-language` and `xml:lang`), mark slots, generate `lyrics.ko.txt`, write `score.musicxml` and a `meta.yaml` stub with `status: draft`; list files it cannot normalize. `npm run build-index` then merges the metadata sources and asserts 645 rows and `acceptance.csv`.
5. `npm run propose-en 405`: hyphenate the Hymnary text with pyphen, cross-check syllable counts with the CMU dictionary (pronouncing), apply `overrides/hyphenation.yaml`, write `lyrics.en.txt` with `?` on doubtful tokens; `npm run check 405` after every edit.

**Volunteer workflow (no git skills).** A Google Sheet lists hymns in priority order with claim and status columns. A volunteer claims a hymn and opens `#/review/405`, the rendered hymn beside a correction form; submitting opens a prefilled GitHub issue (a free GitHub account is needed; a Google Form is the account-free path). GitHub-comfortable volunteers edit `lyrics.en.txt` in the web editor (a PR); the maintainer reviews the rendered SVG artifact, sets `checked_against_book`, and merges.

**Ordering (most-used first).** (1) The church's last 12 months of bulletins, if provided. (2) The 20 most-sung 새찬송가 texts (279, 442, 445, 428, 488, 405, 150, 364, 491, 494, 369, 486, 304, 310, 528, 28, 390, 410, 542, 94, https://www.kosinnews.com/news/articleView.html?idxno=30036). (3) Remaining publishable Western hymns. (4) Korean-composed hymns last, when rights allow.

**Effort model** (estimates; the five-hymn pilot and the first two weeks of app work replace them with real hours).

| Item | Hours |
|---|---|
| Phase 0 spike (three hymns end to end, first scripts and viewer) | 25 to 45 |
| Data setup beyond the spike: 645-file export, audit, importer, both CI workflows | 20 to 30 |
| Hand fixes in MuseScore for files the importer cannot normalize (5 to 10 min each, budget for 100) | 10 to 15 |
| App and tooling build, the whole Phase 1 feature list, evenings with Claude Code | 80 to 150 |
| Per open hymn, volunteer: English alignment against the book plus visual review | 0.4 to 0.5 |
| Per open hymn, maintainer: apply, render, check, merge, metadata and rights | 0.25 to 0.3 |
| **First 50 hymns** (setup and app plus 50 x 0.7 h) | **170 to 275, about 25 volunteer** |
| **All 645** (setup and app plus 535 open x 0.65 to 0.8 h plus 110 gated x 0.2 h for notes and rights only) | **510 to 690, about 215 to 270 volunteer** |

Five members doing two hymns a week each finish the top 20 in two weeks, the first 100 in ten, and the open set in about a year, at about 3 maintainer hours a week.

## 12. Rights and exposure

**Facts from research.** The transcription layer is cleared: all seven ccm4u posts carry CC BY 4.0. Most Western tunes and English texts are public domain in Korea and the US. Korean copyright is life + 70 since 2013-07-01; authors who died on or before 1962-12-31 stayed at life + 50 and are already public domain (한국저작권위원회 explainer in the research). 한국찬송가공회 calls itself the copyright holder of both hymnals and publishes a tariff in which "online score output" is priced and "apps" must inquire (https://hymnkorea.org/21). Courts limited that: no copyright in the hymns it sued over (2011, https://www.newsnjoy.or.kr/news/articleView.html?idxno=35981), only the compilation right in the base hymnal (2015, https://casenote.kr/%EB%8C%80%EB%B2%95%EC%9B%90/2011%EB%8B%A419102), and damages owed to composers for 18 Korean hymns (2018, https://www.newscj.com/news/articleView.html?idxno=534677). In May 2020 it said non-commercial church worship, online worship and PPT use are free (https://www.christiandaily.co.kr/news/90100). Between 108 and 128 hymns are Korean-composed and their English translations are publisher material; the Korean lyric text of every hymn is a translation the 공회 claims, and the 2006 edition reworded many. US law exempts performance in services, not reproduction on a website (https://ccli.com/us/en/religious-services-exemption); GitHub's DMCA process allows about one business day for removal (https://docs.github.com/en/site-policy/content-removal-policies/dmca-takedown-policy).

**Mitigations the design adopts.**

- Three rights layers per hymn, each with its own status and basis, so the label never looks safer than the exposure. `tune` and `text_en`: `pd_verified` (author dead by 1962 per the Hymnary people export, the Korean test, and published before 1931, the US test; both must hold); `pd_likely` (published before 1931 per the Hymnary text or tune date recorded in `basis`, no evidence of a death after 1962; hymn 300 qualifies on its 1906 text date because J. Bruce Evans has no dates in Hymnary); `gated` (a death after 1962, a Korean composer, 1990s Western songs such as 620, ai-draft credits). `text_ko`: `pd_likely` (anonymous or committee translation from 1931 or 1962, unchanged in 2006); `claimed` (2006 revision, a translator not dead by 1962, or unknown, the default until checked); `gated` (Korean-composed original). The build publishes when `tune` and `text_en` are `pd_verified` or `pd_likely` (or English is absent) and `text_ko` is not `gated`; a `claimed` Korean text publishes under posture B because that claim is exactly what the week-one letter asks about. The About page and `TAKEDOWN.md` say, per hymn, which layers are public domain.
- The Korean-composed list comes from two agreeing signals (a Korean composer surname in the bibletoppt credits, a blank old number in `hymn_mapping.json`), then a check against the printed 작사/작곡 line, about two hours for roughly 110 candidates.
- Written requests in week one: an email to hskcopy@gmail.com describing a free, unlisted, single-church tool and asking for no-fee written permission for the Korean-composed hymns and the Korean translations; a guestbook note to 깔끔이 confirming redistribution of derived MusicXML and text (https://ccm4u.tistory.com/guestbook).
- `ATTRIBUTION.md` and an About page naming 깔끔이 CCM (CC BY link and changes made), 낭만고양이 and Hymnary; `TAKEDOWN.md` with a contact; `noindex`, no sitemap, link shared only inside the band; one folder per hymn so any hymn is removed in minutes; a `CHURCH_ONLY=1` build never deployed to Pages; the church's CCLI license checked for the gated titles.

## 13. Risks and mitigations

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| 공회 objects to the Korean lyric text (claimed on nearly every hymn) or the compilation | Medium / high | Layered rights states, gated set, written request, takedown page, one-folder removal, unlisted site |
| OSMD misses the phone budget (first render or reload-path transposition over 1 s) | Medium / medium | Phase 0 measures on the named phone; SVG cache and idle pre-render; updateGraphic path if the chain test passes; snapshot gate; renderNext |
| ccm4u voice layout varies (inferred, not verified) | Medium / medium | Day-one audit writes the rule; importer normalizes; 10 to 15 h hand-fix budget |
| English syllables land on the wrong notes, or need notes the Korean line lacks | High / low | Slot model, CI count check, `?` markers, review page, pilot counts the note-split case |
| Joshua is the only maintainer, and the app build is the biggest single line | High / medium | One script language, `npm run` entry points, plain-English CI messages, no-git volunteer path, actuals replace estimates early |

## 14. Phased roadmap

**Phase 0, spike (25 to 45 hours over two to three weeks of evenings).** Hymns 405, 300 and 31 through the whole pipeline: all 12 keys, all three lyric modes, SVG cache, print to Letter, `#/old/46` resolving to 31. Measured at 4x CPU throttling on a named mid-range Android and an older iPad. Done means: no syllable overlaps at 377 px; first render (everything cached) and reload-path transposition both under 1 s on the phone; the chain test decides the updateGraphic path; a Letter print from the phone with Korean glyphs embedded is legible; a curl of the deployed test page shows `Content-Encoding: gzip` on a hymn file; hymn 300's death-year lookup is done; the renderer flag and snapshot gate are decided.

**Phase 1, MVP (weeks 3 to 10).** The bulletin list plus the 20 most-sung texts published with English (about 40 to 60 hymns), every `reviewed` hymn published Korean-only; search, URL state, prev/next, pedals, set list with print-all, review page, PWA offline, stage mode, About and Takedown pages, CI complete, permission emails sent. Done means: the band runs four consecutive Sundays from the site, including printing the set list, and every English-published hymn is `checked_against_book`.

**Phase 2, full 645 (months 3 to 12).** Notes layer for all 645 from month one; English added in priority order by volunteers; rights table complete. Done means: every non-gated hymn published, the top 100 with reviewed English, "Download all" under 6 MB, quarterly re-check passing.

**Phase 3, extras.** MIDI rehearsal playback (osmd-audio-player), a chord track as a separate JSON per hymn, Bb and Eb instrument transposition through `Sheet.Instruments[i].Transpose`, vocal-range-coloured key chips; each behind a toggle, no schema change.

## 15. Decisions the user must make

1. **Which book does the band hold, and which numbering is the default?** Open the printed book: is 찬양하라 복되신 구세주 예수 number 31 or 46, and is the total 645 or 558? If it shows 46, that book is a 통일찬송가-era bilingual edition. Also photograph a four-verse page so the print rule matches the book. Recommended default: 새찬송가 numbers primary, 통일찬송가 numbers as a searchable alias, both in every header.
2. **Rights posture.** A: publish everything openly with attribution and a takedown page. B: publish public-domain Western hymns with their Korean lyrics unlisted (this exposes the `claimed` Korean text layer while the letter is pending) and gate Korean-composed hymns until written permission. C: church-only build, no public URL, hiding the `claimed` layer entirely. Recommended default: B, with both written requests sent in week one.
3. **English text source for Western hymns.** Public-domain originals from Hymnary (clear rights; wording may differ from the book), or the book's text transcribed by the band (unclear rights). Recommended default: PD originals, verse selection matched to the Korean verse count, differences noted in meta.yaml.
4. **Ordering input.** Provide the last 12 months of bulletins so the first 50 hymns are this church's; otherwise the national lists are used. Recommended default: provide the list, about an hour of work.
5. **Korean lyric font for print.** Noto Serif KR (closest to the printed hymnal) or Noto Sans KR (more legible on a dim stage). Recommended default: serif for print, sans on screen, one extra subset of 150 to 250 KB.
