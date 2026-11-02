# Structural evaluation: Libretto, MusPy, music21

Which symbolic measurements help judge Continuous-Tunes' compositions, and how they were implemented in TypeScript (`src/analysis/symbolic.ts`) without adopting any Python runtime.

## What is measured, and on what

The existing fitness (`src/evolution/fitness.ts`) scores **one genome**: a 2–8 bar loop on a 16-step grid. The listener hears something else: the song. That is several section genomes, transformed by `arrange.ts` (augmented, fragmented, octave-lifted, with role genes), thinned per section energy, given fills, risers and crashes, and played with Tidal-style genes (`degrade`, `ply`, `off`, `nudge`) that Strudel evaluates on every pass.

So the structural analysis runs on **the events Strudel produces**, not the genome. `scripts/analysis/query-events.mjs` evaluates the song in headless Chromium and calls `queryArc` bar by bar. The compiler can label every layer with `.color(name)`, which the audio engine ignores (`compileTimeline(..., { tagLayers: true })`; the audible code is unchanged). Each event comes back with its layer, onset, length, note, gain, velocity and nudge. This also caught things the genome view can't see: gene randomness, fill bars, thinning, and which layers actually sound in each section.

## Sources

| Project | What it is | Runtime / licence | Taken |
|---|---|---|---|
| [Libretto](https://libretto.site/) ([repo](https://github.com/Xyc-arch/Libretto)) | "A descriptive symbolic-music fingerprint environment": MIDI → text grammar → 39 axes, each an empirical percentile against a frozen corpus of ~1,525 Lakh MIDI songs. It says explicitly that it measures "typicality / structure / proximity, **NOT quality**". The measurement layer is deterministic. | Python ≥ 3.11 with numpy, scipy, scikit-learn, pretty_midi and music21; the default generator calls an LLM. Licence file not confirmed. | Its stance (describe, don't score) and axis ideas named on the site: harmonic rhythm, chord variety, stepwise motion, **bar distinctness**, **density variation**, copy risk. The per-axis formulas aren't published on the site, so these are re-derived, not ported. |
| [MusPy](https://muspy.readthedocs.io/en/latest/metrics.html) (Dong et al., ISMIR 2020) | Symbolic music toolkit with standard evaluation metrics | Python, MIT | Exact definitions of pitch-class entropy, scale consistency, empty-beat rate, polyphony, groove consistency |
| [music21](https://music21.org/) | Broad analysis toolkit (harmony, counterpoint, voice leading) | Python, BSD | Nothing new. Tonal and MusicTheoryJS already cover intervals, chords, voice-leading cost and parallel fifths (`theory.ts`). No missing capability justifies a third theory library. |

Libretto's corpus percentiles don't transfer. The corpus is pop and rock MIDI, so "typical" there would push ambient, minimal and DnB toward the wrong norms. Its text grammar drops velocity and micro-timing by design, which is exactly what this milestone adds. So the corpus-relative scoring isn't reproduced. Expectations are genre-relative instead (`src/analysis/flags.ts`).

## Measurements implemented

Per section (roles from the song's form):

| Measurement | Definition | Source of the idea | What it can reveal |
|---|---|---|---|
| density per layer | onsets per bar (chords: one per chord, not per voice) | Libretto density | overly busy or empty sections; how arrangement changes across a song |
| drum distinct bars / 8, bar change | distinct kick/snare/hat/perc onset patterns per 8 bars; Jaccard distance between consecutive bars | Libretto *bar distinctness*; GMD reference | a static loop (1/8) vs. human variation (~7/8) |
| groove consistency | 1 − mean Hamming distance of consecutive bars' 16-step onset vectors | MusPy (Wu & Yang 2020) | how stable the pulse is; very low = random-sounding |
| drum velocity spread, ghost share, timing spread | std/mean of level per instrument × position across bars; snare hits under ½ the backbeat; std of nudges | GMD | machine-flat playing |
| melody pitch range, pitch-class entropy, stepwise share, bar repeat, velocity spread | as named | MusPy, Libretto stepwise motion | wandering or static melodies, flat dynamics |
| harmony changes per bar, distinct chords | pitch-class set of the chord layer per bar | Libretto harmonic rhythm / chord variety | harmonic stasis |
| bass on kick | bass onsets on a kick 16th / bass onsets | genre rule in `styles.ts` | bass fighting the kick in genres that steer around it |
| counter with melody, melody–counter register gap | counter onsets together with melody onsets; difference of medians | libcantus intent (counter fills gaps, sits below) | counter-melody competing with the lead |
| call/response r | correlation of melody and counter+arp activity per half bar | — | negative = the parts take turns; positive = they pile up together |

Per song:

| Measurement | Definition | Source |
|---|---|---|
| scale consistency, pitch-class entropy, empty-beat rate, polyphony | as defined by MusPy, over the tonal layers | MusPy |
| melody bars: distinct, distinct share, varied, novel | distinct melody bar fingerprints (16th positions + intervals, so transpositions match); of these, the share within Jaccard 0.5 of another (developed variants) or of none (unrelated) | Libretto melodic fingerprints; motif development |
| melodic predictability | entropy of interval trigrams, normalised | MusPy-style entropy, Libretto predictability |
| longest unchanged loop | longest run of bars where every layer exactly repeats the bars 1, 2, 4 or 8 bars earlier | monotony |
| section contrast, A/B material contrast, section similarity matrix | RMS distance between section feature vectors (per-layer log density, levels, melody register, drum variation) | Libretto section differentiation |
| transitions | density change between sections, and whether a fill, riser or crash prepares it | weak transitions |

`src/analysis/flags.ts` turns these into questions for a listener, with genre-relative thresholds. For example, `static-drums` fires at ≤ 2 distinct bars / 8 only in genres whose drums imitate players; `unchanged-loop` allows 24 bars in loop-based genres and 16 elsewhere; `busy` has a genre ceiling. Ambient is never asked for DnB's activity.

## What the baseline showed (27 songs, 9 genres × 3 seeds)

From `report.md` of the baseline collection (see [the implementation report](implementation-report.md) for the recordings):

- **Section contrast is healthy**: adjacent sections differ by 0.15–0.37. Arrangement (thinning, pads, counter, fills) already separates sections. Lo-fi is the flattest (0.15), as expected.
- **Melodic material is limited and often unrelated**: 4–14 distinct melody bars per song. In house 71 % and in downtempo 87 % of the distinct bars resemble no other bar (house is flagged `melody-unrelated` on all three seeds). The motif system produces phrases that don't sound like variants of one idea there. Electronic, DnB and trance are closer to half variants, half new.
- **Channel relationships mostly work as designed**: bass-on-kick is 0.00 in house, minimal and trance (steer around), and 0.37–0.59 in DnB, lo-fi, folk and downtempo (lock). The counter-melody rarely starts with the melody (0–0.06 in most genres). Folk is the exception at 0.41 (flagged once), and trance is at 0.22. Melody and counter/arp take turns in electronic (call/response r −0.89), house (−0.94), downtempo and folk (−0.7) and lo-fi and DnB (−0.5). In trance they pile up together (+0.29).
- **Ambient has three unprepared transitions** (big density jumps with no riser) per song. They may be fine for ambient. It's a listening question.
- **Seeds share their starting theme.** `render-songs.ts` starts every seed from the channel's main seed genome (`channelSeed(channel)`), so seeds differ only through evolution inside the song, never in key or mode. Cross-seed melodic distance (Jaccard distance between the songs' sets of melody bars) shows how much that evolution moves the melody. It's 1.0 in folk (the seeds share no melody bar), 0.43 in house and **0.0 in DnB**: all three DnB seeds play exactly the same melody.
- **Every melody and every drum hit was played at one level per position**: `flat-melody-dynamics` on 45 sections and `machine-velocity` on 60. That is the gap the performance layer addressed.

## What was not adopted, and why

- **One overall quality score.** The report is a table of interpretable dimensions plus flags. Nothing is fed back into the fitness, so the evolution can't learn to game a metric that only approximates listening.
- **Corpus percentiles (Libretto).** No suitable corpus exists for these genres, and percentiles against pop MIDI would reward the wrong things.
- **Copy-risk checks.** The generator doesn't learn from any corpus, so there's nothing to copy.
- **music21 counterpoint checks.** The counter-melody is already composed with libcantus-style rules and voice-leading costs from MusicTheoryJS. A second implementation would only re-measure the same rules.

## Recommended next steps

1. **Use `melodyBars` to steer motif development in house.** A mutation preference for variants of existing bars (transposition, rhythm kept) over unrelated new phrases, judged by listening first.
2. **Feed the section-level measurements to the fitness only as guards**, not targets. For example, reject a mutation that makes a section's melody `novel > 0.8`, rather than rewarding low novelty.
3. **Add measurements on demand.** When a listener describes a problem the table doesn't show, add the measurement that would have shown it, and keep it only if it separates songs people liked from ones they didn't.
