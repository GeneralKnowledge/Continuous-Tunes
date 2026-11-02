# Groove analysis: Groove MIDI Dataset

What human drummers do that Continuous-Tunes' drums did not, measured from the Groove MIDI Dataset (GMD) and applied as a small, deterministic performance layer.

## Sources and licensing

| Dataset | What it is | Licence | Used for |
|---|---|---|---|
| [Groove MIDI Dataset v1.0.0](https://magenta.withgoogle.com/datasets/groove) | 13.6 h, 1,150 MIDI files, 10 drummers on a Roland TD-11, recorded to a click, labelled by style, tempo, beat/fill | CC BY 4.0 | All statistics below |
| [Expanded Groove MIDI Dataset (E-GMD) v1.0.0](https://magenta.withgoogle.com/datasets/e-gmd) | 444 h of audio: the GMD performances played back through 43 drum kits | CC BY 4.0 | Checked, not used (see below) |

Attribution required by CC BY 4.0, and given in `src/music/groove-reference.ts` and here:

> Jon Gillick, Adam Roberts, Jesse Engel, Douglas Eck, David Bamman. *Learning to Groove with Inverse Sequence Transformations.* ICML 2019.
> Lee Callender, Curtis Hawthorne, Jesse Engel. *Improving Perceptual Quality of Drum Transcription with the Expanded Groove MIDI Dataset.* 2020.

Only aggregate numbers (means and spreads per style and 16th position) are stored in the repository. No performance, pattern or file from the dataset is copied, and the dataset is not downloaded at runtime.

**E-GMD adds nothing symbolic.** Its CSV has 45,537 rows but only 1,059 distinct performances, each rendered on up to 44 kits. Comparing a performance's E-GMD MIDI with its GMD original gives the same 410 notes with 0.0 ms timing difference and 0 velocity difference on every kit checked. Its value is the audio (for drum transcription), which this project doesn't need. Downloading its 90 GB of audio would be pointless.

## Method

`scripts/analysis/groove-gmd.ts` reads every 4/4 file (`scripts/analysis/midi.ts`, a 100-line MIDI reader) and maps the TD-11 notes to kick, snare (including rim/cross-stick), hi-hat (closed, open, pedal), ride, toms and crash. Hits are quantised to the 16th grid of the click. **Offsets are measured against the bar's own pulse**: the mean offset of that bar's quarter-note hits is subtracted. A drummer drifting ahead of the click over a take then doesn't count as micro-timing (taken raw, every style looks about 0.05 of a 16th early, which is drift and not feel). Beats (503 files, 20,903 bars) and fills (646 files) are analysed separately.

Re-run it with:

```
curl -O https://storage.googleapis.com/magentadata/datasets/groove/groove-v1.0.0-midionly.zip && unzip groove-v1.0.0-midionly.zip
npx tsx scripts/analysis/groove-gmd.ts groove docs/research/data/gmd-groove-stats.json --emit-ts src/music/groove-reference.ts
```

It takes about 2 s. The full output, per style, instrument and 16th position, is in [`data/gmd-groove-stats.json`](data/gmd-groove-stats.json).

## Findings

| Style (beats) | files | bars | ghost share | bar-to-bar change | distinct bars / 8 | 4th bar of phrase: distance / level | off-16th hat offset | hat level: quarter / 8th / 16th |
|---|---:|---:|---:|---:|---:|---|---:|---|
| all | 469 | 20,903 | 0.23 | 0.38 | 6.9 | 0.43 vs ~0.34 / +3.5 % | +0.12 of a 16th | 0.61 / 0.56 / 0.45 |
| rock | 183 | 6,535 | 0.17 | 0.40 | 6.9 | 0.46 vs ~0.39 / +2.4 % | +0.15 | 0.65 / 0.56 / 0.48 |
| funk | 53 | 2,485 | **0.41** | 0.37 | 6.7 | 0.41 vs ~0.27 / +3.5 % | +0.03 | 0.62 / 0.54 / 0.33 |
| hip-hop | 34 | 878 | 0.27 | 0.41 | 6.7 | 0.45 vs ~0.27 / +6.2 % | +0.03 | **0.73** / 0.60 / **0.38** |
| soul | 28 | 627 | 0.33 | 0.30 | 6.3 | 0.34 vs ~0.26 / +1.8 % | +0.09 | 0.59 / 0.55 / 0.42 |
| jazz | 48 | 2,286 | 0.22 | 0.52 | 7.4 | 0.56 vs ~0.54 (flat) | +0.22 (swing) | 0.56 / 0.61 / 0.48 |
| dance | 7 | 554 | 0.19 | 0.32 | 6.2 | 0.42 vs ~0.25 / +6.2 % | +0.06 | 0.57 / 0.66 / 0.52 |

The numbers mean:

- **Ghost share**: the share of snare hits under half the take's median backbeat level. Ghosts gather on the 16th before a beat: GMD counts 3,807 at position 7 and 3,570 at position 15, but only 849 at position 4 and 705 at 12, where the backbeats are.
- **Bar-to-bar change**: the Jaccard distance between consecutive bars' kick/snare/hat onset sets. **Distinct bars / 8**: how many different bar patterns appear in each 8 bars. A fixed loop scores 1; humans score about 7, mostly through small hat and ghost changes.
- **4th bar of phrase**: how far bars 1–4 of each four-bar phrase stray from the take's most common bar, and their level relative to the take's mean. In every style except jazz, the fourth bar is the most varied and the loudest. The first bar is the next loudest.

### What creates the groove (and what doesn't)

1. **Timing is mostly systematic.** Each instrument sits at its own place per 16th position: off-beat 16th hats about 0.05–0.15 of a 16th late, quarter-note hats a hair early, backbeat snares within 0.02 of the pulse. These per-position means are consistent across thousands of bars. The within-position spread (about 15–25 ms, `jitterMs`) is real, but part of it is measurement: tempo wander inside a bar, and 16th rounding of swung notes. Reproducing the spread as random noise is what makes "humanise" buttons sound sloppy. Reproducing the systematic offsets is what sounds like feel.
2. **Velocity carries the groove more than timing.** Hats follow a strong quarter > 8th > 16th level hierarchy (hip-hop: 0.73 / 0.60 / 0.38). Hit-to-hit spread at one position is about 0.10–0.17 of the velocity range (`velocityJitter`).
3. **Variation is placed, not sprinkled.** Bars differ from each other about 35 % of the time, but the difference concentrates at phrase ends (bar 4 of 4) and in ghost notes and hat details, while kick and backbeat stay put.
4. **Kick and snare rarely coincide** (14 % of snare hits; 27 % in "dance", where four-on-the-floor kicks meet the backbeat).
5. **Fills crescendo**: velocity rises about 0.26 of the range per bar through a fill. A tom is 29 % of fill hits; the rest are snare and kick.

## Comparison with Continuous-Tunes' drums (before this work)

Measured on the events Strudel actually plays (`scripts/analysis/query-events.mjs` + `src/analysis/symbolic.ts`), 9 genres × 3 seeds:

| | GMD humans | Continuous-Tunes before |
|---|---|---|
| Per-hit velocity | spread 0.10–0.17 of the range at one position | Per-genre accent map per 16th, **identical in every bar**. Within-position spread is 0.006 (folk) to 0.08 (electronic), and the non-zero part comes from `ply`/`degrade` genes. |
| Micro-timing | systematic per position, plus spread | One constant `feel` offset per layer (lo-fi snare +0.18, hat +0.05), and global swing. **0.0 ms spread on every hit, every genre.** |
| Phrase shape | 4th bar loudest and most varied | None. The only phrase-level change is the section-end fill. |
| Bar-to-bar variation | ~7 distinct bars / 8, placed at phrase ends | 4–8 distinct bars / 8, almost all from Tidal-style `degrade` genes on perc and hats: a per-hit coin toss, so variation is random rather than placed. Kick and snare patterns are identical in every bar of a section. |
| Ghost notes | 17–41 % of snare hits, before beats | Present where accent maps give low values (0.14–0.34) and through the `GhostSnare` mutation. Folk has none. |
| Fills | crescendo, toms 29 % | Rolls and edits already ramp with `saw.range` gain: close to human. |

The genome's representation is the root cause: drums are booleans on a fixed grid, so velocity and timing can only come from genre-wide tables. See the gap analysis in [musical-quality-audit.md](musical-quality-audit.md).

## What was implemented

`src/music/performance.ts`, driven by `src/music/groove-reference.ts` (generated from the dataset) and a `performance` profile per genre in `styles.ts`. It is applied by the compiler at render time. The genome doesn't change, so saved genomes and lineages are unaffected and simply gain the performance.

| Technique | GMD basis | Per genre |
|---|---|---|
| Per-position micro-timing via Strudel's `nudge` (seconds per hit) | reference style's mean offset per 16th × `timing` | lo-fi 1.0 and downtempo 0.8 (hip-hop reference), folk 1.0 (rock), dnb 0.6 (funk), house 0.5 (soul), ambient 0.3; electronic, minimal and trance 0 (programmed) |
| Small hashed timing spread | far below the dataset's spread, on purpose (see finding 1) | 0–4 ms |
| Hit-to-hit velocity spread | reference `velocityJitter` relative to its mean level × `velocity` | 0.25 (trance) to 0.8 (lo-fi, folk) |
| Four-bar phrase level | measured `phraseVelocity` × 1.5 | all genres with drums |
| Phrase-end pickup | a ghost snare (or, in programmed genres, a closed hat) on the last 16th of each 4-bar phrase, else before beat 3 or on the "e" of beat 4, where GMD's ghosts gather | ghosts: house, downtempo, lo-fi, dnb; hat pickup: electronic, minimal, trance |

Everything is a deterministic function of the genome: hashes are seeded by the drum pattern and tempo (`performanceSeed`) and evaluated at the hit's time. The same seed and configuration give the same audio, and `compileTimeline(..., { performance: 0 })` (or `PERFORMANCE=0` for the scripts) reproduces the old output byte for byte. That is tested, and it is how the baseline collection was rendered.

### Deliberately not done

- **No pattern copying and no model.** GrooVAE and Drumify (Magenta Studio) learn a performance from these same files. Their insight, that a performance is a function of the written part plus a style, is what `performance.ts` implements by hand. Their models (TensorFlow.js checkpoints of several MB, Magenta.js is in maintenance) would add a large runtime dependency and non-determinism across platforms.
- **Swing was not re-tuned.** Off-beat offsets from the reference are added on top of each genre's existing swing value. For jazz-like triplet swing the 16th quantisation is the wrong grid; none of the current genres uses it.
- **Fills were left alone.** They already crescendo; their tom/snare mix is a sound-design question.

## Recommended next steps

1. **Placed variation instead of `degrade`.** Replace some degrade genes (random per hit) with phrase-aware variations: a different hat figure in bar 4, an open hat before the drop, a kick pickup into bar 1. GMD shows variation concentrating there.
2. **Per-hit velocity in the genome (optional field).** Only if listening shows the hashed spread is not enough: an optional `velocity?: number[]` per drum line, mutated by "accent" and "crescendo" operators. This is the representation change the gap analysis supports.
3. **Drums responding to the melody** (Drumify-style conditioning): thin or soften hats where the melody is busiest, and push a kick or a ghost into melodic rests. `context.ts` already knows where the melody attacks.
