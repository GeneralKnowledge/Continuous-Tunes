# Implementation report: musical quality and research integration

## What changed

| Change | Where | Why |
|---|---|---|
| Audio analysis in plain TypeScript: tempo and stability, onsets, BS.1770 loudness and range, spectrum, band balance, chroma/key, section and bar similarity | `src/analysis/audio.ts` | To measure the music as rendered. Essentia.js was evaluated and kept out (size, API stability, licence-clean analysis code); it is used as an out-of-tree cross-check ([audio-analysis.md](audio-analysis.md)) |
| Symbolic and structural analysis of the events Strudel actually plays (MusPy and Libretto ideas, GMD reference) | `src/analysis/symbolic.ts`, `scripts/analysis/query-events.mjs`, compiler option `tagLayers` | The fitness sees one loop genome; the listener hears arranged songs with genes, fills and thinning ([structural-evaluation.md](structural-evaluation.md)) |
| Genre-relative weakness flags | `src/analysis/flags.ts` | To turn measurements into listening prompts, without a single score |
| Repeatable collections, reports, comparisons and a blind A/B listening page | `scripts/analysis/make-collection.mjs`, `analyze.ts`, `compare.ts` | The validation workflow (M1/M6) |
| Groove MIDI Dataset statistics | `scripts/analysis/groove-gmd.ts`, `midi.ts` → `src/music/groove-reference.ts`, `docs/research/data/gmd-groove-stats.json` | A measurable human reference ([groove-analysis.md](groove-analysis.md)) |
| **Performance layer**: per-hit drum velocity and micro-timing, four-bar phrase shape, phrase-end ghost/hat pickups, bass dynamics against the kick, KTH-style dynamics for melody, counter and arp | `src/music/performance.ts`, `performance` profiles in `styles.ts`, compiler | The biggest measured gap: every hit and every note was played at one level per position, with no micro-timing, and bar variation was random rather than placed |
| Ambient kit trim 2.3 → 1.1 | `src/music/kits.ts` | Found by the audio analysis: ambient played 6–7 LU louder than every other channel and clipped (1.4 % of samples past full scale) after PR #12 |
| Representation gap checks | `scripts/analysis/representation-gaps.ts` | Concrete evidence for the gap analysis in [musical-quality-audit.md](musical-quality-audit.md) |

The genome, mutations, fitness, evolution and song structure are untouched. The performance layer is applied when compiling, as a deterministic function of the genome and its genre. Saved genomes and lineages play unchanged apart from the performance, and no `seedVersion` was bumped. `compileTimeline(…, { performance: 0 })` (scripts: `PERFORMANCE=0`) reproduces the previous code byte for byte; a test checks this, and the baseline was rendered that way.

## What was tested

- `npm test`: 199 tests pass, 15 of them new (`tests/performance-analysis.test.ts`). They cover determinism; performance depth 0 reproducing the old output; phrase pickups only on real phrase ends; timing limits; bass/kick and line dynamics; MIDI note parsing; static-loop and motif-variant detection; tempo of a click track; BS.1770 loudness of a sine within 1 LU; key of an A-minor chroma; and section analysis.
- `tsc -b`, `tsc -p tsconfig.test.json`, `oxlint`: clean.
- Every compiled song was evaluated by Strudel in headless Chromium (event queries for 54 songs) and recorded through the real audio pipeline. The new `.gain("…")` and `.nudge("…")` patterns play: the nudges and per-hit gains show up in the queried events.

## Collections and conditions

Both collections were made with `scripts/analysis/make-collection.mjs` under the same conditions: 9 channels × seeds 42, 7 and 2026, `short` songs, `record-songs.mjs` at three in parallel, real time, dirt-samples and worklet synths, 192 kbps MP3. That is 27 songs and about 82 minutes of music per collection.

- **baseline**: commit `4f418ee` with `PERFORMANCE=0`, whose code is byte-identical to `main` after PR #12 (checked for all 27 songs).
- **improved**: this branch.

They are in the project files under `recordings/research/`:

```
recordings/research/
  listening.html          blind A/B page: 27 pairs, preference + groove + interest + notes, export JSON
  comparison.md           per-genre baseline → improved
  baseline/report.md      full report: every song, every flag
  improved/report.md
  baseline|improved/seed-<n>/<genre>.mp3, songs.json (genomes + Strudel code), events.json
  baseline/essentia-crosscheck.json
```

## What was measured

Per-genre means over the three seeds, baseline → improved (full table: `recordings/research/comparison.md`):

| genre | LUFS | drum velocity spread | drum timing spread (ms) | ghost share | distinct drum bars / 8 | audio: near-identical bar pairs | section contrast |
|---|---|---|---|---|---|---|---|
| electronic | −15.2 → −15.1 | 0.082 → 0.111 | 0 → 0 | 0.20 → 0.18 | 5.6 → 5.6 | 0.31 → 0.30 | 0.287 → 0.287 |
| ambient | **−9.2 → −15.2** | 0.045 → 0.088 | 0 → 1.9 | – | 4.2 → 4.2 | 0.03 → 0.02 | 0.231 → 0.210 |
| minimal | −16.2 → −16.2 | 0.009 → 0.040 | 0 → 0 | 0.14 → 0.14 | 4.3 → 4.5 | 0.43 → 0.43 | 0.258 → 0.266 |
| house | −15.7 → −16.0 | 0.039 → 0.061 | 0 → 2.5 | 0.22 → 0.28 | 5.1 → 5.1 | 0.29 → 0.23 | 0.259 → 0.261 |
| downtempo | −15.7 → −15.7 | 0.009 → 0.101 | 0 → 4.3 | 0.20 → 0.26 | 6.5 → 7.0 | 0.22 → 0.16 | 0.248 → 0.249 |
| folk | −16.4 → −16.4 | 0.006 → 0.072 | 0 → 4.0 | 0 → 0 | 5.4 → 5.4 | 0.32 → 0.32 | 0.259 → 0.259 |
| lo-fi | −14.8 → −14.5 | 0.010 → 0.092 | 0 → 5.6 | 0.31 → 0.34 | 8.0 → 8.0 | 0.16 → 0.20 | 0.151 → 0.151 |
| dnb | −17.9 → −18.0 | 0.057 → 0.117 | 0 → 2.2 | 0.34 → 0.38 | 6.3 → 6.5 | 0.26 → 0.23 | 0.251 → 0.250 |
| trance | −15.6 → −15.6 | 0.037 → 0.077 | 0 → 0 | 0.01 → 0.01 | 4.5 → 4.6 | 0.19 → 0.19 | 0.366 → 0.366 |

For reference, GMD drummers show a velocity spread of about 0.2–0.3 of the mean and about 7 distinct bars per 8. The improved drums stay below that on purpose: these are mostly programmed genres.

Flags across the 27 songs (every occurrence), baseline → improved: flat-melody-dynamics 45 → 0, grid-locked 81 → 4, machine-velocity 60 → 4, audio-loop 28 → 21, over-full-scale 21 → 18 (songs), static-drums 12 → 12, melody-unrelated 9 → 9, no-ghosts 12 → 12, unprepared-transition 5 → 5, tempo-unstable 10 → 11.

The performance numbers moved because that's what the performance layer does. **This shows the changes are in the audio, not that the music is better.** Flags such as `machine-velocity` and `grid-locked` were cleared by design, so their counts dropping is circular. These are the measurements that weren't targeted:

- **Loudness, loudness range, section contrast and onset rates** didn't move outside ambient. The performance layer doesn't change mix balance or arrangement, as intended.
- **Ambient** now sits at −15.2 LUFS, level with the other channels, and no longer clips.
- **Micro-timing hardly shows in the audio**: the onset spread around the 16th grid moved by under 2 ms (lo-fi 14.5 → 15.3, folk 18.4 → 20.2). Reverb and the 23 ms analysis hop smear a few ms, so the symbolic timing spread is the measure of what was played. A first pass let some hip-hop-derived offsets reach 25 ms: downtempo's audio onset spread jumped from 9.5 to 33 ms. The offsets are now capped (±0.12 of a 16th, ±12 ms per hit), and those six genres were re-recorded.
- **Fewer near-identical bars** in house, downtempo and DnB drops (audio-loop 28 → 21 sections): hit-to-hit velocity and the phrase shape make bars differ slightly. This is partly a side effect of the targeted change, not new musical material.
- **Untouched structural problems are still flagged**: static drums (trance, house, minimal), melodies without one developing idea (house), audible looping in EDM drops, peaks above full scale everywhere, and unprepared ambient transitions. They are the next priorities.

Cross-check against Essentia.js on the 27 baseline recordings:

| | ours | Essentia.js 0.1.3 |
|---|---|---|
| Tempo within 0.5 BPM of written (octave-folded) | 23 / 27 | 26 / 27 |
| Key: right pitch set | 18 / 27 (15 before the cross-check led to a two-step estimator) | 23 / 27 |
| Onset rate | 1.3–1.9× Essentia's (more sensitive detector, counts quiet hats) | — |
| Time per song | ~1.7 s at 22 kHz | ~18 s at 44.1 kHz |

The cross-check also found a bias in our tempo estimate (126 BPM read as 123.5, from the octave prior), which is now fixed. Essentia is clearly better at key. If key matters, run the cross-check rather than trusting `key` in our reports.

## What was heard

**Nothing yet.** I can't listen to audio. Every statement above comes from measurements of the recordings and of Strudel's events, and none of them shows the music got better. **Listening is the remaining evaluation, and it decides.** Open `recordings/research/listening.html` next to the two collection folders; it plays each pair in a hidden, fixed random order. For each pair, note:

1. which you prefer, overall;
2. which groove feels more human (expected: lo-fi, folk, downtempo, house, DnB; should be indistinguishable in trance and minimal apart from velocity and phrase pickups);
3. which stays more interesting over time;
4. what you heard: sloppiness, flams, a pumping bass, a lead that breathes or one that wobbles.

Export the answers, and the next iteration tunes the `performance` profiles in `styles.ts` from them. Settings to try for a groove comparison: `PERFORMANCE=0.5` (half depth) against 1.0 on the same seeds.

## What remains incomplete

- **Human listening** (above).
- **Performance profiles are first guesses** from GMD reference styles; house, DnB and folk in particular need ears.
- **Headroom**: all genres peak above full scale. Needs a decision: a master limiter, or a −3 dB global trim with re-trimmed kits.
- **Placed variation**: replace part of the random `degrade` variation with phrase-aware drum changes (trance, house, minimal static drums; EDM drops loop audibly).
- **Motif development** in house and downtempo melodies.
- **Seed diversity**: render-songs starts every seed from the channel's main seed genome (DnB's melody was identical across seeds). Let it pick `channelSeed(channel, rngSeed)` and make a new baseline.
- **Representation**: no genome change was justified yet. Tuplets, independent cycles and half-bar chords are documented gaps for when a genre needs them; optional per-hit drum velocity only if listening shows the hashed spread isn't enough.
- The analysis doesn't feed the fitness, on purpose. If it ever does, use it as a guard (reject the extreme), never as a target.
