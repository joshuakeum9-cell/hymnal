# English overrides

Put a file named `NNN.txt` here (for example `149.txt`) to supply the English words for hymn NNN
yourself. It replaces the English source for that hymn. Use one block per verse, one line per
sung line, and a blank line between verses, in the same order as the Korean verses. Lines
starting with `#` are ignored. Hyphenate multi-syllable words the way a hymnal does
(`Sav-iour`, `glo-ry`) when you know the split; otherwise the tool splits them.

Then run `python tools/align_english.py NNN` and check the result on the site.

Hymns whose English source had another hymn's words, and so have no English yet:
5, 147, 149, 159, 164, 188, 189, 205, 249, 261, 285, 297, 346, 354, 363, 423, 440, 453, 457,
460, 478, 499, 518, 587, 595, 631.
