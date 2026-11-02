# Musical quality audit

An audit of what Continuous-Tunes already does musically, what the research projects in the brief offer, where the real gaps are, and what to do next. It covers M1 (audit and baseline) and feeds M2–M6. Measurements come from the baseline collection: 9 genres × seeds 42, 7 and 2026, short songs, rendered by `main` after PR #12. See [implementation-report.md](implementation-report.md) for how they were made and heard.

## 1. The pipeline as it is

```
seeds.ts (channel theme genome)
  → evolution (mutation.ts, fitness.ts on the loop genome)
  → song.ts / form.ts (sections: role, bars, energy, A/B material; one genome per section)
  → arrange.ts (augmentation, fragmentation, octave lifts, counter entry, role and repeat genes)
  → compiler.ts (energy → layers, thinning, pads, filters, level; fills, risers, crashes;
                 genes → Strudel transforms; swing; accents; voices from kits.ts)
  → Strudel (evaluates genes on every pass, schedules, synthesises)
  → audio
```

What already exists and covers ideas in the brief (so it was not rebuilt):

| Brief idea | Already there |
|---|---|
| Genre rhythmic vocabulary | `styles.ts` groove: per-16th accent maps per instrument, `feel` lay-back, swing ranges, bass figures, fills per genre |
| Bass responding to kick | `bassKick: avoid / lock / free` steers bass onsets (compose.ts) and is in the fitness (`kickInterplay`) |
| Counter-melody filling gaps | `counter.ts` (libcantus rules) writes into melody gaps and holds, below the melody |
| Motif development | `motif.ts` transformations; `placeCell` keeps them on the harmony |
| Section development, transitions | `arrange.ts` per-role treatment; fills, builds, risers, crashes; energy → layers, filters, level |
| Time-aware patterns | `pattern.ts`, a Tidal-style query engine with tuplets, Euclid, polymeter, seeded randomness |
| Symbolic quality heuristics | `fitness.ts`: density, syncopation, repetition per layer, harmonic consistency, smoothness, motif identity, cadence |
| Voice leading, intervals, chords | `theory.ts` (Tonal, MusicTheoryJS): voice-leading cost, parallels, Tonal chord vocabulary. music21 adds nothing needed. |
| Rendering and inspection | `render-songs.ts`, `record-songs.mjs`, `query-strudel.mjs` |

## 2. Where information is lost (representation gap analysis)

Each item was checked by code (`npx tsx scripts/analysis/representation-gaps.ts`) or by querying the events Strudel plays.

| # | Musical idea | What happens | Evidence | Matters now? |
|---|---|---|---|---|
| 1 | Triplets / tuplets | `toSteps` rounds to the 16th grid. A triplet at 0.250 / 0.333 / 0.417 bars becomes 0.250 / 0.313 / 0.438. `eventsToMini` can write exact weighted mini-notation, but **the compiler never calls it**. | script item 1 | Not yet: no seed or mutation writes tuplets. Becomes real once a genre wants triplet hats (trap-style lo-fi) or folk triplet melodies. |
| 2 | Polyrhythm (5 against 4) | Quintuplets land on 0, 3, 6, 10, 13: up to 50 ms off at 120 BPM | script item 2 | Same as 1 |
| 3 | Independent instrument cycles | Ambient's 10-step arp phase runs inside the genome loop, so it **resets every 64 steps** instead of drifting for 20 bars. Strudel itself could keep it independent. | script item 3 | Slightly: the "phasing" ambient arp audibly realigns every loop |
| 4 | Duration and articulation | One `gate` per layer. A legato phrase with one staccato note can't be written, and `toHolds` lengths are dropped | script item 4 | Moderately: lines are uniformly legato or detached |
| 5 | Expressive velocity and timing | Drums are booleans. Velocity is a per-genre, per-16th table identical in every bar; timing is one `feel` value per layer plus global swing. Measured: **0.0 ms timing spread on every drum hit in every genre**, drum velocity spread 0.006–0.08, and every melody note at one level (`flat-melody-dynamics` on 45 sections). | events query, baseline report | **Yes.** This is the biggest audible gap against human drumming (see groove-analysis.md) |
| 6 | Motif transformations keep their meaning | Augmentation keeps only the first bar of each pair and stretches it: the house theme goes from 17 notes to 10, and bars 2 and 4 of the motif are never heard in breakdowns. | script item 6 | Somewhat: breakdowns quote half the idea, which may be fine musically |
| 7 | Harmonic rhythm | One chord root per bar. Two chords in a bar (turnarounds, passing chords) can't be written | script item 7 | For folk and lo-fi turnarounds, later |
| 8 | Arrangement / performance instructions | Energy, roles and genes cover arrangement well. **Performance (how a part is played) had no representation at all** | code | Yes, same as 5 |
| 9 | Variation between bars | Bar-to-bar variation comes from Tidal `degrade` / `sometimesBy` genes: a seeded coin toss per hit, so it's random, not placed. Kick and snare are identical in every bar of a section. | events: house groove has 1 kick pattern and 8 perc patterns in 8 bars | Yes: humans vary at phrase ends, not everywhere (GMD) |
| 10 | Fitness judges the loop, the listener hears the song | `evaluateFitness` scores one 2–8 bar genome. Arrangement, genes, fills and section contrast are invisible to it. | code | Context for every metric decision: the new analysis measures songs and doesn't feed the fitness |

**Conclusion: don't rewrite the genome.** The one limitation that matters musically today, expressive performance (rows 5, 8 and 9), doesn't need new genome fields. A player interprets a written part, so performance is computed at render time from the genome and the genre (`src/music/performance.ts`). Saved genomes stay valid. If listening shows hashed velocity isn't enough, the smallest justified genome change is an optional per-hit velocity array for drums (groove-analysis.md, next steps). Tuplets (rows 1–3) need only the compiler to use `eventsToMini` for layers built from patterns, once a genre actually writes them.

## 3. Baseline: known quality problems

Symbolic and structural measurements on the played events, plus audio measurements on the recordings (`report.md` of the baseline collection):

AUDIO_FINDINGS

Symbolic:

- **Machine-flat performance** everywhere (rows 5 and 9 above).
- **Static drums** in trance (3/3 seeds), house (3/3) and minimal (2/3): ≤ 2 distinct drum bars per 8 in long sections. In trance the longest stretch of an exactly repeating loop is 23 bars.
- **Melodies that don't develop one idea**: in house 71 % and in downtempo 87 % of the distinct melody bars resemble no other.
- **Seeds share their starting theme**: render-songs starts every seed from the main seed genome. DnB's melody was identical across all three seeds; folk's shared nothing.
- **Healthy**: section contrast (0.15–0.37), bass/kick relationships per genre rule, counter-melody mostly avoiding melody onsets, call and response between melody and counter/arp (r ≈ −0.5 to −0.9; trance +0.3 is the exception).

## 4. Research findings (summary)

| Source | Useful | Adopted as |
|---|---|---|
| Essentia.js | Accurate tempo/key in Node and browser; AGPL-3.0, 10 MB, unstable API, slow rhythm extractor | Not a dependency. Own TS analysis; Essentia as an out-of-tree cross-check ([audio-analysis.md](audio-analysis.md)) |
| Groove MIDI Dataset | Systematic per-position timing, velocity hierarchy, placed phrase-end variation, ghost positions, by style | `groove-reference.ts` statistics + `performance.ts` ([groove-analysis.md](groove-analysis.md)) |
| E-GMD | Same MIDI as GMD on 44 kits | Not used |
| Libretto | Descriptive fingerprints; "typicality, not quality"; bar distinctness, density variation, harmonic rhythm | Ideas re-derived in `src/analysis/symbolic.ts`, no corpus percentiles ([structural-evaluation.md](structural-evaluation.md)) |
| MusPy | Standard metric definitions | pitch-class entropy, scale consistency, empty-beat rate, polyphony, groove consistency |
| Magenta Studio (Groove, Drumify) | Performance = f(written part, style); drums conditioned on another part | The same idea by hand in `performance.ts`; models not adopted (size, non-determinism, unmaintained runtime) |
| music21 | Counterpoint and harmony analysis | Covered by Tonal + MusicTheoryJS; not adopted |
| librosa / madmom | Onset-strength / peak-picking and tempo techniques | Technique references for `audio.ts` |

## 5. Genuine gaps and recommended priorities

In order of expected musical return per effort:

1. **Listen to the baseline vs. improved pairs** (`listening.html`) and record preferences. Nothing below should be tuned before that.
2. **Performance depth per genre**, tuned by ear: the `performance` profiles in `styles.ts` are first guesses grounded in GMD, not tuned by listening.
3. **Placed variation instead of random `degrade`**: phrase-end hat and kick variations, an open hat or pickup into section starts, fewer per-hit coin tosses (trance, house, minimal static drums).
4. **Motif development in house and downtempo**: prefer variants of existing bars over unrelated phrases (`melodyBars` shows the problem; use it as a guard, not a target).
5. **Headroom**: every genre peaks around +3 dBFS in the recordings (0.03–0.26 % of samples past full scale; ambient was 1.4 % before its trim was fixed). A master limiter or a global −3 dB with re-trimmed kits would stop clipping on real outputs.
6. **Seed diversity in the offline workflow**: let render-songs pick `channelSeed(channel, rngSeed)` variants, so seeds also differ in theme (needs a new baseline).
7. **Tuplets via `eventsToMini`** and **half-bar chords**: only when a genre needs them.
