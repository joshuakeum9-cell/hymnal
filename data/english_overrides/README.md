# English overrides

Put a file named `NNN.txt` here (for example `149.txt`) to supply the English words for hymn NNN
yourself. It replaces the English source for that hymn. Use one block per verse, one line per
sung line, and a blank line between verses, in the same order as the Korean verses. Lines
starting with `#` are ignored. Hyphenate multi-syllable words the way a hymnal does
(`Sav-iour`, `glo-ry`) when you know the split; otherwise the tool splits them.

Then run `python tools/align_english.py NNN` and check the result on the site.

The files here replace English that the source had wrong (another hymn's words). Their wording follows the Korean-English (한영) hymnal as printed on prayertents.com, checked for public-domain status on hymnary.org; research notes are in each file's first line. Hymn 363 has no public-domain English (its Korean text is an original psalm setting), so it has no file.
