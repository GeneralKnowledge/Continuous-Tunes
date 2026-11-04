# Continuous Speech: M2 audit, research assessment and plan

November 2026. Written before and during the M2 work; the results section is kept up to date with
what was actually measured. The M1 description is in [README.md](README.md) and the first
research pass in [research-assessment.md](research-assessment.md); this document does not repeat
them.

## 1. Audit of the M1 engine

Everything below was read in the code (PR #14, merged) and, where it says *measured*, checked on
rendered audio with the new per-phone analysis (`segmentAcoustics` in `metrics.ts`).

### What works and should be kept

| Area | Code | Verdict |
|---|---|---|
| Text normalisation | `normalize.ts`, `numbers.ts` | Good coverage (money, dates, times, ordinals, units, initialisms). Keep. |
| Lexicon chain | `lexicon.ts`, Britfone → CMUdict→SSB → morphology → letter rules | Sound design; alternatives and sources kept per word. Keep. |
| Phoneme layer | `phonemes.ts` (IPA, SSB inventory, features) | Dictionary-independent, as asked. Keep. |
| Syllabification | `syllables.ts` (maximal onset with legal English onsets) | Adequate. Keep. |
| Durations | `prosody.ts`, Klatt 1979 rules | Faithful, measured rate 4.4 syll/s, stressed/unstressed ratio 3:1. Keep. |
| Intonation | `prosody.ts` | Simple but well-behaved (pitch tracks plan to 0.14 st; questions rise, statements fall). Keep; refine in M5. |
| SpeechPlan | `plan.ts` | Small and backend-neutral (an MBROLA `.pho` plus position). Keep as the single interface. |
| Resonators, frame interpolation | `backends/formant/klatt.ts` | Correct Klatt 1980 resonators/anti-resonators. Keep. |
| Benchmark | `benchmark.ts`, `scripts/speech/benchmark.ts`, Whisper | Good base; reproducible (bit-identical re-renders). Extend, don't replace. |
| UI | `src/ui/SpeechPanel.tsx`, `Shell.tsx` | Works; music stays mounted. Keep. |

### What is inaccurate (measured), in order of audible impact

1. **The voice source was ~15 dB too dark.** KLGLOTT88 plus an extra tilt low-pass and output
   differencing left F2/F3 far below Peterson & Barney's measured formant amplitudes
   (/iː/: A2−A1 −28 dB vs −20 natural; A3−A1 −34 vs −24). Energy above 2.5 kHz in vowels was
   ~0.03% of the total. Formant transitions carry place of articulation in F2/F3, so a dark source
   hides exactly the cues that distinguish b/d/g, m/n and k/t, and it is the main reason the
   voice sounds muffled and "synthetic".
2. **Fricative noise sat above 8 kHz.** White noise was differenced (+6 dB/oct) before the
   frication bands, putting the spectral centroid of /f/ at 8.0 kHz and /θ/ at 7.6 kHz (natural:
   ~5 kHz, Jongman et al. 2000). Speech recognisers (16 kHz) and phone/Bluetooth playback discard
   everything above 8 kHz, which is the measured cause of the "weak /f θ v/" benchmark failure.
3. **Fricatives had no low-frequency cut-off.** Two-pole band resonators leave skirts: /s/ had
   energy at 1 kHz only 9 dB under its peak and /ʃ/ at 0–1 kHz only 3–5 dB under. Natural
   sibilants have almost nothing below the front-cavity resonance (~3 kHz for /s/, ~2 kHz for
   /ʃ/). This blurs /s/–/ʃ/ and /ʃ/–/tʃ/.
4. **Voiced fricatives were vowel-like.** /v ð/ measured 6 dB under vowels with 98% of their
   energy under 500 Hz: a nasal-like murmur with no frication. /z/ likewise (centroid 1.7 kHz).
   This explains /z/→/s/ ("zoo"→"so") and part of "nasals heard as stops": n and ð were nearly
   identical acoustically.
5. **Stop releases were blocks of flat noise.** Natural releases are transients that decay into
   aspiration; a held block (12–25 ms at full level) is heard as an affricate
   ("cat"→"catch"), and word-final releases before a pause were full strength.
6. **Voiced bursts were inaudible** (release centroid ~350 Hz for /b g/), so "say bead" was
   heard as "save it": the closure murmur reads as /v/ when no release follows.

### What is incomplete

- No glottal model with a voice-quality control beyond open quotient; no flutter (slow f0 drift).
- No per-phone acoustic diagnostics; only one recogniser, with a strong language model; minimal
  pairs only as carrier sentences with free transcription, so the score mixed acoustics with
  language-model guessing. No A/B against a fixed baseline.
- Nasals have murmur and a moving zero but no anti-formant during the adjacent vowel beyond the
  `nasality` blend; linking /r/, homographs and connected-speech reductions are absent (M5).
- Speech evolution (`SpeechVoice` as a genome) is designed but has no harness.

### What is unnecessarily complicated

Little. The formant backend's phase/boundary machinery (`buildPhases`, `boundaryFormants`,
`transitionSides`) is dense but does real work. The only clear simplification was removing the
output differencing (radiation is now folded into the source), which also removed the coupling
between radiation and frication spectra that caused problem 2.

## 2. Research and reuse assessment

Licences were read from package metadata (npm, crates.io) in November 2026.

### Synthesis

| Project | What it provides | Kind | Runtime | Licence | Decision |
|---|---|---|---|---|---|
| **chdh/klatt-syn** (npm `klatt-syn` 1.0.9) | Complete Klatt cascade/parallel synthesiser in TypeScript (impulsive and KLGLOTT88 "natural" sources, 6 formants, parallel branch with per-formant amplitudes, flutter, AGC) | Library | TS, browser/Node, no deps | MIT | **Reference and cross-check.** Our `klatt.ts` already implements the same filters; swapping cores would not fix any measured problem (all were in the control parameters and source). Useful as an independent implementation to compare frames against; worth adopting its 6-formant parallel branch if we move bursts to formant-coupled noise (M3). |
| **Pink Trombone** (Neil Thapen) via **chdh/pink-trombone-mod** (npm `pink-trombone-mod` 0.1.0) | 44-section Kelly–Lochbaum waveguide tract with nasal branch, LF glottis parameterised by tenseness → Rd, turbulence noise at constrictions, transients | Library (modular port) | TS, Web Audio-independent core | MIT | **Reused now:** its LF/Rd glottal pulse computation (attributed in `klatt.ts`). **Next (M4):** the experimental articulatory backend should drive `pink-trombone-mod`'s `Tract` directly instead of writing a waveguide ourselves. |
| `pink-trombone` crate (lostmsu) | Rust port of the same | Library | Rust/WASM | MIT | Not needed: profiling (below) shows the TypeScript engine runs ~40× faster than real time. |
| Praat / KlattGrid | KlattGrid synthesiser, Burg formant tracking, pitch (autocorrelation), spectral moments | Application + Python binding `praat-parselmouth` | C++/Python | GPL-3 | **Dev-only analysis tool**, never linked into the app. |
| eSpeak NG | Rule-based TTS incl. Klatt and en-GB rules | Application | C | GPL-3 | Reference only (unchanged from M1). |
| MBROLA | Diphone concatenation with MBR-PSOLA; voices non-redistributable | Engine + data | C | AGPL-3 (engine), voices restrictive | Reference only. |
| Festival / Festvox / Flite | Diphone and unit-selection voice building, CART LTS | Toolkits | C/C++/Scheme | X11/BSD-style | Reference for the diphone corpus recipe (M6). |
| TD-PSOLA (Moulines & Charpentier 1990) | Pitch/duration modification of recorded units | Algorithm | — | Patent expired | Implement only when there are recorded units (M6); it does nothing for a formant engine, which already controls f0 and timing directly. |
| LF model (Fant, Liljencrants & Lin 1985; Rd: Fant 1995) | Glottal flow derivative with a one-parameter voice-quality control | Algorithm | — | Published | **Adopted** as the formant backend's source. |

### Linguistic processing

CMUdict and Britfone stay (see M1 assessment). eSpeak NG's en-GB rules remain off-limits (GPL).
For homographs, the cheapest effective resource is a small hand list keyed by part of speech
(the classic ~400 English homographs); a POS tagger is the dependency to evaluate in M5
(candidates: `wink-pos-tagger`, MIT, ~1 MB; or a rule-based tagger for the handful of homograph
contexts). Syllabification and stress need no new resource.

### DSP and analysis

| Need | Choice |
|---|---|
| FFT | The project already has a radix-2 FFT in `src/analysis/audio.ts` (music analysis); speech metrics now reuse it instead of adding `fft.js`. |
| Filters/resonators | Keep our own: Klatt resonators and an RBJ-cookbook biquad high-pass are ~60 lines together; a DSP library would add weight for no gain. |
| Pitch, formants, spectral moments of output | Our autocorrelation f0 (in `metrics.ts`) plus Praat via parselmouth for spot checks. |
| Resampling | Existing windowed-sinc in `audio.ts`. |
| Speech recognition (evaluation only) | sherpa-onnx (Apache-2.0) with four offline models: Whisper base.en and small.en (MIT weights; strong language model), NeMo Citrinet-512 CTC and a Zipformer transducer (both little or no language model, so closer to the acoustics). All downloaded from sherpa-onnx's GitHub releases; never shipped. |

### Optimisation and evaluation research

- **Search:** CMA-ES (`cmaes` Python package, MIT) for continuous voice parameters; Optuna (MIT)
  NSGA-II/TPE for multi-objective runs with constraints. Both run the Node renderer as a
  subprocess. Plain evolutionary search in TypeScript is also viable because rendering the whole
  benchmark takes ~2 s; the bottleneck is recognition (~15 s per model per run).
- **Objectives kept separate:** intelligibility (closed-set diagnostic accuracy across four
  recognisers, plus WER on the core set), pronunciation (letter-to-sound error vs Britfone),
  naturalness (human A/B and MOS-style ratings; automatic MOS predictors such as UTMOS are neural
  and only an auxiliary), consistency (re-render determinism, f0 tracking, level stability).
- **Perceptual distance to reference speech:** MCD after DTW against VCTK recordings of the same
  sentences is the standard objective measure; it needs a British reference speaker and alignment
  (deferred to M6 with the corpus work).
- **Caution:** improving one recogniser's score is easy to overfit; every change here is
  justified first by an acoustic measurement against published natural values, and only then
  checked on the recognisers.

## 3. Milestones

Ordered by expected audible benefit per unit of work, with dependencies.

| # | Milestone | Why this order | Status |
|---|---|---|---|
| M2a | **Measurement first**: frozen M1 backend for A/B, consonant diagnostic set, four recognisers, per-phone acoustics, voice hashes, A/B listening page | Every later change needs to be shown, not asserted | done in this PR |
| M2b | **Source**: LF/Rd glottal pulse, flutter, calibrated spectral balance | Largest single audible defect; cheap | done in this PR |
| M2c | **Obstruent acoustics**: flat-after-radiation noise, front-cavity high-pass, fricative spectra and levels from Jongman 2000, voiced fricatives with real frication, transient bursts, weak final releases | Directly targets the benchmark failures | done in this PR |
| M3 | **Formant-coupled bursts and nasals**: move release noise into a 6-formant parallel branch driven by the transition's own formants (klatt-syn's layout); nasal pole/zero pairs during adjacent vowels; vowel targets per context (front/back locus tables) | Next-largest consonant cue errors; needs M2 measurements to tune | next |
| M4 | **Voice genome + search harness**: CMA-ES/NSGA-II over bounded `SpeechVoice` + target-table offsets, objectives as above, every run logged with voice hash and git commit | Turns hand-tuning into reproducible experiments | planned |
| M5 | **Prosody and connected speech**: linking /r/, homographs, function-word reduction by rate, phrase planning, ToBI-style British tunes | Naturalness once segments are reliable | planned |
| M6 | **Experimental backends**: (a) articulatory via `pink-trombone-mod` driven from SpeechPlan; (b) diphone/PSOLA only once a clean British diphone set exists | Only promoted if they beat the formant engine on the same plans | planned |

Acceptance criterion for promoting any change into the default `formant` backend: no regression
on mean WER across the four recognisers on the core set, an improvement on the diagnostic set or
on the targeted acoustic measurement, no new clipping or discontinuities, and an A/B listen.

## 4. Results

See section 5 of this file (filled in when the M2 runs complete).
