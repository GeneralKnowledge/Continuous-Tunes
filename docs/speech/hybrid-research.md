# Hybrid speech engine: research, prototypes and plan

November 2026. Source commit: `0c51197` (main after PR #16) plus this branch. Every number below
can be reproduced with the commands in [Reproducing](#reproducing); the raw reports are in the
scratch areas named there and the listening material is in the project files under
`recordings/speech/hybrid/`.

## Summary

- Six engines were made to say the same thing from the same `SpeechPlan` (same words, phones,
  durations and pitch): the current formant engine, the formant engine driven by natural glottal
  pulses (recorded excitation), a Pink Trombone–style articulatory tract, our own diphones cut
  from CMU ARCTIC with TD-PSOLA, MBROLA with the British `en1` diphones, VocalTractLab and
  TGSpeechBox.
- **Recorded diphones are the largest available gain.** MBROLA `en1`, driven by our plans, has
  roughly half the recogniser error of the formant engine (17% vs 30% WER) and the best
  diagnostic-contrast score (56% vs 36%). It wins mostly on consonants: sh/ch 96% vs 54%,
  fricative voicing 62% vs 23%.
- Our own diphones from a different (Scottish) speaker, aligned automatically and selected
  naively, are not there yet (51% WER) but are the closest to the natural recordings
  spectrally, which says the route works and the selection and alignment are the weak points.
- Recorded excitation (natural glottal pulses under the formant filters) is at parity with the
  LF model on recognisers (32.5% vs 29.7%, inside about 2σ) and slightly closer to natural
  speech spectrally. It is a voice-quality option, not an intelligibility fix.
- Articulatory synthesis (our tract, VocalTractLab) is far behind on consonants. It stays a
  research backend.
- **Decision:** make the recorded-unit path the primary quality engine, keep the formant engine
  as the fallback and controllable layer (and the default until the unit path beats it in a
  blind test), and hybridise at the unit level: formant-synthesised diphones fill gaps in the
  unit inventory, joined pitch-synchronously, rather than crossfading two whole engines.

## 1. Where we started (audit)

The M1/M2 pipeline (see [README](README.md)) is text → lexicon/G2P → `SpeechPlan` → backend.
The plan is backend-neutral: segments (phone, start, duration, stress, role, word) and a pitch
contour. That turned out to be the most valuable part of the design for this work: every
prototype here, including the external C/C++ engines, consumes the same plan, so differences in
the results come from the acoustic layer only.

What limited the formant engine after M2/M3/M5:

- Consonants. The diagnostic contrasts that fail are fricative voicing (23%), vowels in minimal
  pairs (23%) and labiodental/dental (35%). Hand-tuned Klatt targets for transitions, bursts and
  frication are hard to get right one parameter at a time.
- Voice quality. The LF source is clean and periodic; it sounds synthetic regardless of
  intelligibility ("B does sound better but it is subtle" was the verdict on the M3/M5 A/B).
- Recognisers vary a lot run to run (σ ≈ 1.5 points mean WER), so only changes of more than about
  3 points are visible with one seed.

## 2. Candidates

| Candidate | What it provides | Licence | Language/voices | Maintenance | Dependencies | Integration | Measured here | Verdict |
|---|---|---|---|---|---|---|---|---|
| Our formant engine (Klatt cascade/parallel, LF source) | Full control of every parameter, tiny, deterministic | ours | any (targets per phone) | ours | none | in tree | 29.7% WER, 36% diag | keep: fallback, control layer, default for now |
| Recorded excitation (IAIF pulses from ARCTIC) | natural glottal pulse shapes under our filters | ARCTIC: permissive, attribution | voice-independent pulses | ours | none at runtime | in tree (`source.excitation`) | 32.5% WER (mix 0.5), MCD 74 vs 77 | keep as option, tune later |
| Pink Trombone tract (`pink-trombone-mod`) | Kelly–Lochbaum waveguide, nose, turbulence | MIT | articulatory, needs area functions per phone | dormant package | 1 small npm package | in tree as `tract` backend | 62.9% WER, 9% diag | research only |
| VocalTractLab | 3-D articulatory model, gestural score, good vowels | GPL-3, research use | German speaker model | active, academic | C++ lib | out of tree only (GPL) | 50.2% WER, 15% diag | do not integrate; reference only |
| TGSpeechBox | modern Klatt-style formant engine with rules | MIT | English packs, tuned for eSpeak phonemes | active, small | C++ | out of tree test | 81% WER (our phone mapping, see caveat) | reject for now |
| klattsch | compact Klatt implementation | MIT | – | small | C | not run | – | nothing beyond our own Klatt |
| eSpeak NG | formant/rule engine, many languages | GPL-3 | many | active | C | not used (licence) | – | no code or data copied |
| MBROLA + `en1` | diphone concatenation (MBR-PSOLA), British male voice | engine AGPL-3; `en1` free to redistribute, only for use with MBROLA | British English (RP) | engine maintained, voices frozen | C, ~6.5 MB voice | out of tree test via `.pho` from our plans | **16.7% WER, 56% diag** | adopt as the first unit engine (WASM build), see H1 |
| Own diphones (ARCTIC `awb`) + TD-PSOLA | units from any corpus we can align | ARCTIC permissive | Scottish speaker (SSB plans mismatch) | ours | none at runtime | in tree as `units` backend | 51.3% WER, closest MCD | keep: the long-term path, needs H3/H4 |
| Festival/FestVox | unit selection, clustergen, RELP | permissive (MIT-like) | – | dormant | large | ideas only (join costs, RELP) | – | reuse methods, not code |
| Neural vocoder (comparison only) | very natural | varies | – | – | large models | not built | – | not primary, per brief |

Caveat on TGSpeechBox: its rules expect eSpeak's phoneme output; we fed it IPA mapped from our
plans, with stress marks and pauses, at its own rate. Three mapping attempts did not lift it
below 80% WER, so treat the number as "does not fit our plans", not as a verdict on the engine.

Caveat on VocalTractLab: it was driven with its German speaker and SAMPA approximations of our
English phones (no /w/, /ɹ/ mapped to uvular). It is still the best-sounding articulatory engine
here on vowels.

## 3. Prototypes built in this round

All are registered backends or offline scripts. None changes the default voice: `alder` is
unchanged and `alder-m1` is still bit-identical (hash `fb2380e8…`).

- `tract` backend (`src/speech/backends/tract/`): Pink Trombone's waveguide at 88.2 kHz (so 44
  sections are a 17 cm tract; at 44.1 kHz it is twice too long), vowel area functions fitted by
  Nelder–Mead to our formant targets (`scripts/speech/fit-tract.ts`), consonant constriction
  gestures on an Öhman vowel substrate, LF source, seeded frication, release transients.
- `units` backend (`src/speech/backends/units/`): diphones (mid-phone to mid-phone) placed on the
  plan, re-timed and re-pitched with TD-PSOLA. The database is loaded at runtime with
  `setUnitDatabase`; nothing recorded ships in the repository.
- Corpus pipeline (`scripts/speech/corpus/`): render each ARCTIC prompt with our engine,
  align recording to rendering by DTW on MFCCs (synthesis-based alignment), carry phone
  boundaries across, take pitch marks from Praat; then build a diphone database or extract
  glottal pulses. 1138 utterances aligned; the last 52 b-set prompts are held out from both.
- Recorded excitation (`source.excitation` 0–1 on formant voices): glottal flow-derivative
  pulses by simplified IAIF, 64 most typical periods, ordered along their main axis of
  variation and walked slowly, aligned to the LF pulse's main excitation.
- `scripts/speech/external/render.py`: drives MBROLA, VocalTractLab and TGSpeechBox from our
  plan JSON, so they can be scored by the same benchmark (`benchmark.ts --wavs`).
- `scripts/speech/natural-compare.py`: spectral (MCD on DTW-aligned MFCC cepstra), pitch and
  timing distance to natural recordings of held-out sentences.
- `scripts/speech/listen-multi.py`: blind multi-engine listening test with the natural recording
  as hidden reference.

What changed between rounds (each kept because the numbers moved):

| Change | Before | After |
|---|---|---|
| Own diphones: skip candidates whose voiced half has fewer than 2 pitch marks | 60.0% WER | 51.3% |
| Recorded excitation: IAIF instead of plain LPC residual, PCA-ordered walk, peak alignment | 45.4% WER, F0 corr 0.06 | 37.4% (full), 32.5% (mix 0.5), F0 corr 0.39 |
| Tract at 88.2 kHz, white frication noise, sibilant places moved | (unusable) | 62.9% |

## 4. Results

### Recognisers (114 items, Whisper base/small, Citrinet, Zipformer)

Mean over the four recognisers; lower WER and higher diagnostic accuracy are better. Formant is
three seeds (± σ); the others are one seed, so read differences under about 3 points as noise.

| Engine | Mean WER | Diagnostic | nasal/stop | f/θ | k/t | sh/ch | final voicing | fric. voicing | vowels | Render RTF |
|---|---|---|---|---|---|---|---|---|---|---|
| MBROLA `en1` (our plans) | **16.7%** | **56%** | 60 | 60 | 41 | 96 | 46 | 62 | 38 | C, not timed |
| Formant (current default) | 29.7 ± 1.3% | 36% | 39 | 35 | 43 | 54 | 35 | 23 | 23 | 0.008 |
| Formant + recorded excitation 0.5 | 32.5% | 34% | 38 | 32 | 31 | 58 | 25 | 31 | 25 | 0.009 |
| Formant + recorded excitation 1.0 | 37.4% | 36% | 45 | 35 | 28 | 58 | 25 | 31 | 25 | 0.009 |
| VocalTractLab (German speaker) | 50.2% | 15% | 15 | 30 | 28 | 0 | 0 | 0 | 16 | C++, not timed |
| Own diphones (ARCTIC awb) | 51.3% | 21% | 32 | 25 | 28 | 12 | 8 | 12 | 12 | 0.002 |
| Articulatory tract | 62.9% | 9% | 10 | 8 | 19 | 8 | 0 | 0 | 9 | 0.078 |
| TGSpeechBox (mapped phones) | 81.2% | 5% | – | – | – | – | – | – | – | C++ |

RTF is render time over audio time on one Node thread (lower is faster). All in-tree engines are
far inside real time.

### Distance to natural recordings (52 held-out ARCTIC sentences)

Same sentences, natural speaker `awb` (Scottish). MCD is on MFCC-style cepstra, so its absolute
value is not comparable with published mel-cepstral distortions; the ranking is what matters.
F0 RMSE is after removing each voice's mean pitch.

| Engine | MCD | F0 RMSE (cents) | F0 corr | V/UV agree | Duration ratio |
|---|---|---|---|---|---|
| Own diphones v2 (same speaker as reference) | **55.5** | 254 | 0.36 | **84%** | **0.96** |
| MBROLA `en1` | 65.0 | **234** | 0.41 | 83% | 0.86 |
| VocalTractLab | 68.9 | 274 | 0.22 | 79% | 0.86 |
| TGSpeechBox | 73.7 | 240 | **0.47** | 72% | 0.67 |
| Formant + recorded excitation 1.0 | 73.8 | 254 | 0.36 | 78% | 0.87 |
| Formant + recorded excitation 0.5 | 74.1 | 244 | 0.39 | 78% | 0.87 |
| Formant (current) | 76.5 | 240 | 0.41 | 79% | 0.87 |
| Articulatory tract | 81.2 | 255 | 0.33 | 78% | 0.88 |
| Formant M1 | 81.8 | 234 | 0.42 | 81% | 0.87 |

Readings:

- Our own diphones being closest is partly because they are the same speaker; MBROLA, a
  different speaker, still beats every procedural engine by a wide margin.
- All engines share our plans, so they share our prosody: F0 RMSE is 230–275 cents and
  correlation about 0.4 for everyone. **Prosody is now the common bottleneck for naturalness**,
  not any one backend. Our plans are also about 13% faster than this speaker.

### Blind listening test

[Listening test](https://claude.ai/artifact/FyZ9vT6Neq1gbK27jjo9QF) (also in project files,
`recordings/speech/hybrid/listening-test/index.html`): 8 held-out sentences, six engines and the
real recording in random order per sentence, levels matched, scored 0–100. Results to be added
here once listened to; the test is part of the keep/reject evidence for H1.

## 5. Architecture decision

The common representation stays the `SpeechPlan`. It was enough for every engine tried,
including three external ones. One addition is planned (H2): per-segment provenance, so a
renderer can say which unit or rule produced each stretch, and the evaluation can attribute
errors.

Routing: **by unit, not by sound class across engines.** The tempting split, vowels from the
formant engine and consonants from recordings, would put an engine boundary inside every
syllable, which is exactly where joins are most audible; and the measurements say recorded
units are better on vowels too. Instead:

1. The unit engine renders every diphone it has.
2. A missing diphone is rendered by the formant engine from the same plan slice, then matched to
   its neighbours at the join: same pitch marks (both are pitch-synchronous), spectral envelope
   matched by a short LPC-domain interpolation across one or two periods, level matched. No
   fixed-length crossfade.
3. Voice identity (speaker, recordings, pulses) stays in the unit database and voice; delivery
   (rate, pitch range, emphasis) stays in the plan. Changing one does not touch the other.
4. The formant engine stays complete and selectable: it is the fallback for any phone set, the
   tool for voice design and effects, and the reference for regression tests.
5. Articulatory engines remain research backends, not routed into the default path.

## 6. Corpora and recordings

- CMU ARCTIC (`awb`, used here): permissive licence with attribution; 1138 prompts, about 1 hour;
  Scottish speaker, so our SSB transcriptions disagree with what he says on some vowels and /r/.
  Good enough to build and debug the pipeline, not to be the voice.
- VCTK (CC-BY 4.0, 110 speakers, several Southern English): the best freely licensed source of an
  SSB-like voice, but about 400 sentences per speaker, so diphone coverage needs checking.
  **Not reachable from this environment**: datashare.ed.ac.uk is blocked by the network policy,
  as are festvox.org, openslr and Common Voice. Only GitHub, npm and PyPI are reachable.
- Common Voice (CC0): many speakers, short and noisy clips; useful for pulse statistics or
  evaluation, poor for units.
- A dedicated corpus is the end state for a voice of our own. Requirements: one speaker, SSB,
  1–2 hours in a quiet treated room, 44.1 kHz/24-bit close mic, a script chosen greedily for
  diphone and stressed/unstressed coverage (ARCTIC-style), plus a few hundred nonsense-word
  carriers for rare diphones, and an EGG channel if available (pitch marks for free). The
  pipeline here (synthesis-based alignment, pitch marks, unit build) works on it unchanged.
  Recording is not needed for H1–H3.
- Tools: alignment by DTW against our own synthesis (Malfrère & Dutoit 1997) works without any
  external aligner (median DTW cost 0.71, boundaries typically 15–30 ms off). Montreal Forced
  Aligner would be more accurate if we need it later (MIT, conda-based, large). Pitch marks from
  Praat via parselmouth (GPL, offline data preparation only; nothing ships).

## 7. Milestones

Each milestone states the problem, code involved, reuse, implementation, test, expected gain and
the evidence that decides keep or reject.

### H1. MBROLA unit backend in the browser
- Problem: the formant engine's consonants; recorded diphones halve recogniser error.
- Code: new `src/speech/backends/mbrola/`; plan → `.pho` exists in `scripts/speech/external/render.py`.
- Reuse: MBROLA C sources compiled to WebAssembly (`zig cc -target wasm32-wasi`, available from
  PyPI), `en1` voice loaded at runtime like the unit database.
- Licence: engine AGPL-3; the app is already AGPL-3.0-or-later through `@strudel/web`, so
  shipping the engine is compatible as long as source stays available. `en1` may be
  redistributed but only used with MBROLA; record that in the README's data table.
- Test: bit-reproducible render; RTF; benchmark on 3 seeds; blind test against the formant engine.
- Expected gain: mean WER 30% → about 17%, diagnostic 36% → about 55%.
- Keep if it beats the formant engine by more than 5 points WER on three seeds and wins the
  blind test; otherwise keep as an optional backend only.

### H2. Hybrid fill-in and joins
- Problem: any diphone inventory has gaps (`units` leaves silence today); engines must agree at joins.
- Code: `units` backend; formant backend as the gap renderer; plan provenance field.
- Implementation: render gaps with the formant engine from the same plan slice, pitch-synchronous
  join with envelope interpolation (section 5).
- Test: coverage stress set (rare diphones, names); count of formant-filled diphones; listening.
- Expected gain: no silent gaps; joins not audible in the blind test.
- Keep if WER with forced gaps (drop 10% of diphones) stays within 3 points of the full inventory.

### H3. Unit selection instead of one diphone per pair
- Problem: one-best diphones from automatic alignment carry alignment errors and pitch/duration
  mismatches (own diphones 51% WER).
- Reuse: Hunt & Black target and join costs (as in Festival's clunits), our existing alignment output.
- Implementation: keep several candidates per diphone; Viterbi over target cost (duration,
  pitch, stress, context) plus join cost (MFCC and f0 distance at the cut).
- Test: benchmark plus `natural-compare` on held-out sentences.
- Expected gain: own-diphone WER 51% → under 30%; closes much of the gap to MBROLA.
- Keep if both recognisers and MCD improve on held-out sentences.

### H4. A voice we own
- Problem: `en1` is a frozen 1990s voice; `awb` is the wrong accent.
- Route A (no recording): VCTK Southern English speaker once its host is allowed. Route B: the
  dedicated corpus in section 6.
- Test: as H3, plus blind test against MBROLA.
- Keep if it matches MBROLA on recognisers and wins on naturalness.

### H5. Prosody from data
- Problem: every engine shares our prosody, and F0 correlation with the natural speaker is
  about 0.4 for all of them; plans are about 13% fast.
- Reuse: aligned ARCTIC phones (durations by phone, stress and position) and pitch tracks.
- Implementation: fit duration and accent-shape parameters of `prosody.ts` to the aligned
  corpus with CMA-ES, multi-objective (duration RMSE, F0 RMSE/correlation, recogniser WER), on
  training prompts only; held-out prompts for the report.
- Expected gain: duration ratio → 1.0, F0 correlation 0.4 → 0.6; benefits every backend.
- Keep if held-out F0 and duration distances improve without WER loss.

### H6. Recorded excitation tuning
- Problem: natural pulses help spectral distance but cost a little intelligibility at full mix.
- Implementation: mix and pulse-walk parameters into the CMA-ES search; pulses from the H4 voice.
- Keep if it wins the blind test at equal WER.

### H7. Articulatory research track (low priority)
- Problem: tract consonants near 0% on voicing contrasts; F3 off by up to 350 Hz on back vowels.
- Implementation: fit consonant constrictions to burst and frication spectra of the aligned
  corpus; use VocalTractLab only offline as a target generator (GPL stays out of tree).
- Keep only if it gets within 10 points WER of the formant engine.

Order: H1 and H5 first (largest gains, independent), then H2, H3, H4 as corpus access allows; H6
and H7 when the rest is stable. Strudel and the music system are untouched by all of them.

## Reproducing

```sh
# research checkouts live outside the repository (~/research): MBROLA, MBROLA-voices (en1),
# VocalTractLabBackend-dev, TGSpeechBox, CMU ARCTIC awb
npx tsx scripts/speech/corpus/synth-prompts.ts ~/research/awb/etc/txt.done.data ~/research/awb-synth
python3 scripts/speech/corpus/align.py ~/research/awb/wav ~/research/awb-synth ~/research/awb-align
python3 scripts/speech/corpus/build-units.py ~/research/awb/wav ~/research/awb-align ~/research/awb-units2
python3 scripts/speech/corpus/extract-pulses.py ~/research/awb/wav ~/research/awb-align ~/research/awb-pulses2.json
# recognisers (internal engines)
npx tsx scripts/speech/benchmark.ts r-units2 alder --set all --backend units --units ~/research/awb-units2
npx tsx scripts/speech/benchmark.ts r-rex50 rex50.json --set all --pulses ~/research/awb-pulses2.json
# external engines: export plans, render, score the WAVs
npx tsx scripts/speech/export-plans.ts plans/
python3 scripts/speech/external/render.py mbrola plans/ out-mbrola/
npx tsx scripts/speech/benchmark.ts x-mbrola --set all --wavs out-mbrola --name mbrola
# held-out comparison and listening test
npx tsx scripts/speech/corpus/synth-prompts.ts ~/research/awb/etc/txt.done.data nat/units2 --backend units --units ~/research/awb-units2 --from arctic_b0490
python3 scripts/speech/natural-compare.py ~/research/awb/wav formant=nat/formant units2=nat/units2 …
python3 scripts/speech/listen-multi.py listening-test ~/research/awb/wav formant=nat/formant …
```

Recorded-excitation voices are `alder` with `source.excitation` set to 1.0 or 0.5. Recogniser
setup is as in the README (Whisper base/small, Citrinet and Zipformer via sherpa-onnx).
