# A Strudel-native voice

**Goal:** Continuous-Tunes gets its own speaking voice, and **Strudel produces every sample of it**.
The app turns text into one Strudel program. Pasted into the standard REPL (strudel.cc), that program
speaks. TypeScript only plans what to say: phones, timing, stress, pitch and articulation. It never
generates audio for this voice.

This document records the architecture decisions, the research behind them, the measurements, and
the plan. It follows on from [strudel-speech.md](strudel-speech.md), the pattern-only version from
PR #18 and #19.

## Architecture (V1)

```
text ─► front end (TS) ─► SpeechPlan ─► articulation planner (TS) ─► control track
                                                                         │
            Strudel program  ◄───────────────────────────────────────────┘
            ├─ voice instrument: AudioWorklet source text, loaded with audioWorklet.addModule
            ├─ registerSound('ctvoice', …)   ← a normal Strudel sound
            ├─ the control track (one compact string per utterance)
            └─ setcps(1 / seconds); s("ctvoice")   ← Strudel schedules the utterance
```

- **The instrument is part of the pasted code.** The program loads the worklet from a `data:` URL,
  as Strudel's own `dspWorklet` does. It then registers it with `registerSound`, Strudel's
  documented way to add a sound. The voice therefore goes through Strudel's normal output chain:
  `.gain`, `.lpf`, `.room`, `.delay` and the others all apply.
- **One continuous sound per utterance.** Strudel triggers the sound once. The worklet runs the
  whole utterance from its control track, with the glottal phase and all filter states carried
  through. Articulation changes underneath with nothing restarting. This removes the per-event
  oscillator restarts and crossfades, which cost the pattern version most of its intelligibility.
- **Sample-accurate start.** Strudel hands the event's audio-clock time to the sound. The worklet
  compares it with `currentFrame` and starts on that sample.
- **Control track.** The planner's 5 ms frames carry f0, voicing, aspiration, frication, F1–F5 with
  bandwidths, the nasal zero, three frication bands and voice quality (Rd). Each parameter is
  stored as a piecewise-linear line, with breakpoints only where a straight line would stray more
  than a perceptual tolerance (1.2% for formants, 0.6 Hz for f0). That is about 3–5 KB per sentence.
  The worklet interpolates per sample and updates the filter coefficients every 16 samples.
- **DSP in V1:**
  - Source: Fant's LF glottal flow derivative, shaped by Rd, with jitter, shimmer, Klatt's flutter,
    breath noise gated by the open phase, and tilt.
  - Tract: Klatt's cascade (nasal pole and zero, five formants, fixed higher poles) and a parallel
    frication branch with a bypass path. Frication is modulated by the glottal cycle when voiced.
  - Cost: about 3% of one core at 48 kHz, measured by rendering offline under Node.
- **Code layout:**

  | File | Contents |
  |---|---|
  | `src/speech/strudel/instrument/processor.ts` | The worklet. Self-contained, serialised with `toString()`, no outside references. |
  | `src/speech/strudel/instrument/compile.ts` | Track encoder and program generator. |
  | `src/speech/strudel/instrument/offline.ts` | Runs the same worklet in Node, for tests and parameter searches. |

  The Speech tab's **Copy Strudel voice** button emits this program. The pattern-only version
  stays available as **Copy Strudel (patterns only)**.

Gotchas, all found in the browser:

- Strudel reads **double-quoted and backtick strings as mini-notation**, so every plain string in
  the program is single-quoted, object keys included. A quoted key such as `{"gain": 1}` is a
  syntax error after transpiling.
- Bundlers can make a serialised function depend on helpers outside it. esbuild's `__name` (tsx,
  dev builds) is shimmed at the top of the source. A test evaluates the source with nothing but
  worklet globals in scope, and checks it is ASCII, because `btoa` needs Latin-1.
- An error while a worklet module is evaluated does not reject `addModule`. The only symptom is
  "node name … is not defined" when the sound triggers.

### Is this "Strudel generating the voice"?

Yes, in the sense the brief allows: a custom registered Strudel sound whose DSP is an AudioWorklet
defined inside the Strudel program. No audio is rendered outside Strudel and played back. There
are no samples, no external engine, and the TypeScript formant engine is not called. The
worklet's source/filter design starts as a Klatt-style formant tract (V1), because that is the
best-measured model we have. The next milestones replace the planner and tract with an
articulatory model (below).

## Results

All Strudel numbers come from **real-time renders in headless Chromium through `@strudel/web`**,
the same path as pasting into the REPL. Lower WER is better. Four recognisers are used: Whisper
base, Whisper small, NeMo Citrinet (CTC) and Zipformer (transducer). The last two have little
language model, so they are closer to the acoustics.

**Sentence benchmark** (114 items, the same plans for every engine):

| Engine | Whisper base | Whisper small | Citrinet | Zipformer | Mean WER | Diagnostic words |
|---|---|---|---|---|---|---|
| **Strudel voice instrument (V1)** | 19% | 17% | 44% | 35% | **28.7%** | 33.7% |
| Strudel patterns (PR #19) | 40% | 33% | 85% | 60% | 54.4% | 14.9% |
| Strudel patterns (PR #18) | 40% | 34% | 80% | 81% | 58.5% | 20% |
| TypeScript formant engine (reference only) | 17% | 17% | 52% | 32% | 29.7% | 36% |

**Voice corpus** (80 items, `src/speech/strudel/corpus.ts`). Values are WER per category. Targets
counts carrier items whose test word was heard, summed over the four recognisers.

| Engine | Vowel | Consonant | Transition | Long word | Phrase | Sentence | Question | Stress | All (mean of 4) | Targets |
|---|---|---|---|---|---|---|---|---|---|---|
| **V1 instrument** | 36 | 41 | 33 | 41 | 32 | 21 | 42 | 16 | **33.5** | **94/248** |
| PR #19 patterns | 67 | 71 | 65 | 83 | 48 | 42 | 49 | 44 | 60.6 | 43/248 |

The **click count** (`voice-eval.py`, brief broadband bursts per second) is 0.49/s for V1 and
0.14/s for PR #19. Looking at the hits, V1's are voicing onsets after voiceless consonants: the
first glottal pulse standing out from the frication before it. They are not discontinuities. PR #19
scores lower because its crossfades smear every onset. The detector still needs to separate the
two. Until then, this number is not a quality ranking.

Reproduce:

```
npx tsx scripts/speech/strudel-compile-plans.ts <plans> items.json alder --instrument   # benchmark
npx tsx scripts/speech/voice-corpus.ts items.json [--engine patterns]                  # corpus
node scripts/speech/strudel-render.mjs items.json <dir>/x 3                               # real time
python3 scripts/speech/asr_whisper.py <dir> <models…>
python3 scripts/speech/voice-eval.py items.json <dir>
```

### Round 2 experiments (after V1)

**V2 waveguide** (`tract-processor.ts`, `articulation.ts`, engine `tract`). A Kelly–Lochbaum tract
after Pink Trombone (44 sections, 28-section nose, tract rate 88.2 kHz scaled by the voice's
formant scale) driven by an articulatory planner: a vowel substrate of four mode weights fitted to
our formant targets, plus up to three overlapping consonant gestures, lip rounding, velum and
turbulence channels. Vowel formants measured with Praat land on their targets. Consonants do not:

| Variant (quick set, 41 items) | Whisper small | Zipformer |
|---|---|---|
| V1 instrument | 19.4% | 45.7% |
| Waveguide, first working version | 55.9% | 68.3% |
| + band-passed aspiration, low-passed turbulence (/s/ peak 11.9 → 7.5 kHz) | 55.4% | 69.4% |
| + wall radiation for a voice bar | worse (75% mean over four) | |
| + places and widths fitted to V1's locus equations (about 1 Bark error) | worse (93%) | |

On the 80-item corpus it averages about 79% WER, against 33.5% for V1. Its weaknesses are stop
bursts, the voice bar during closures and fricative spectra; fixing them means modelling pressure
build-up, which Pink Trombone does not do either. It stays in the code as an experiment (Copy
Strudel uses V1) and the decision was to improve V1 first.

**Consonant voicing cues on V1** (voice bar during voiced closures, longer bursts, voicing offset
before voiceless stops). All neutral within noise. The most frequent error ("say X" heard as
"save …") moved with the recogniser, not with the acoustics, so we read it as language-model bias
and removed the experiment.

**Expression layer** (`expression.ts`, option `expression`, off by default). It edits V1's frames
from the plan's linguistic structure: tenser and 1.5 dB louder accented vowels, laxer and 2.5 dB
softer unstressed ones, a breathy, 4 dB quieter relaxation at phrase ends, and microprosody (f0
raised after voiceless obstruents and dipped in voiced ones). WER moves from 28.7% to 29.6% on the
benchmark, within noise except fricative voicing on the diagnostic words (19% → 31% errors). WER
is not a naturalness measure, so the decision waits for the listening test.

**Blind listening test**: the 8 held-out ARCTIC sentences from earlier rounds, spoken by PR #19
patterns, V1, V1 with expression and the waveguide, plus the real recording as a hidden reference,
scored 0–100 for naturalness (`scripts/speech/listen-multi.py`; page and audio in project files,
`recordings/speech/strudel-voice/listening-test/`). Scores to follow.

## Research: what to borrow

The question for each source was what can run inside a worklet, be driven by our planner, and
measurably help.

| Source | What it offers | What we take |
|---|---|---|
| **Pink Trombone** (Thapen 2017, MIT) | 44-section Kelly–Lochbaum tract with a 28-section nose and velum coupling, two scattering updates per sample; LF glottis driven by "tenseness"; turbulence injected at the constriction; articulators are tongue position and diameter plus point constrictions. | The waveguide for V2, written for the worklet. Turbulence injected *at the constriction*, so fricative spectra follow place. We already depend on `pink-trombone-mod`, and our earlier articulatory backend used it. Its 63% WER came from our crude consonant gestures and noise, not from the waveguide. |
| **VocalTractLab** (Birkholz) | Geometric 3D tract; gestural scores; a *target approximation model*, where each articulator approaches its target through a critically damped higher-order system (Birkholz 2007); time-domain transmission line with losses; noise sources at constrictions. | Target approximation for every articulator and for f0 (qTA, Prom-on, Xu & Birkholz). Overlapping gestures then give anticipatory coarticulation without hand-written transition rules. No runtime dependency: GPL, concepts only. |
| **Story's airway modulation model** (Story 2005; Story & Titze 1998) | Area function = neutral tube + two vowel modes, with consonant constrictions superimposed multiplicatively on the vowel-to-vowel movement. | Already used for our vowel shapes (`backends/tract/vowel-shapes.ts`, fitted to our formant targets). This becomes V2's planner: a vowel substrate plus consonant gestures (Öhman 1966). |
| **Klatt / KLSYN88** (Klatt 1980; Klatt & Klatt 1990) | Cascade/parallel resonators, voiced/unvoiced sources, voiced-frication modulation, bypass path, tilt and open-quotient controls. | V1's tract. The cascade stays as a fallback tract and as the target of the "articulatory planner → formants" route. |
| **LF model** (Fant, Liljencrants & Lin 1985; Rd: Fant 1995) | One-parameter glottal pulse family from tense to lax. | V1's source. Next: Rd driven by stress and phrase position, so stressed vowels are tenser and phrase ends are laxer or creaky (Gobl & Ní Chasaide 2003). |
| **Maeda's articulatory model** (1990) | Seven factor-analysed articulators: jaw, tongue body, dorsum, tip, lip height, protrusion, larynx. | Candidate parameterisation if two vowel modes prove too few. |
| **Distinctive Region Model** (Carré & Mrayati; used by gnuspeech's TRM) | Eight tract regions whose constrictions move formants in known directions. | Concepts only (gnuspeech is GPL): a cheap way to place consonant constrictions. |
| **Praat** (Boersma & Weenink) | Burg LPC formants, autocorrelation pitch, HNR, jitter and shimmer. | Analysis only: formant and f0 tracks of our renders against recordings. Via `praat-parselmouth` in the evaluation scripts if needed. Never in the product. |
| **Pink Trombone optimisation** (Cámara & Reiss, DAFx 2023; *Parameter optimisation for a physical model of the vocal system*) | Genetic algorithms, particle swarm and Bayesian search over Pink Trombone controls to match recorded vowels. | V5: evolutionary search over our voice and articulation parameters against the CMU ARCTIC recordings we already hold, with the Strudel render in the loop. `offline.ts` runs the same worklet faster than real time. |

## Plan

| Step | What | How we judge it |
|---|---|---|
| V0 ✓ | Fixed corpus, baselines, renderer, scorer | Numbers above |
| V1 ✓ | Continuous instrument (LF source + formant tract) | 54.4% → 28.7% WER |
| V2 (experiment) | Articulatory planner: Story-style area functions, gestures with target approximation. Two tracts compared in the worklet: Kelly–Lochbaum waveguide, and formants computed from the area function | Corpus WER, blind A/B, CPU |
| V3 | Consonants from the tract: closure, pressure build-up and release burst, turbulence at the constriction, voice bar, VOT | Consonant and diagnostic scores |
| V4 | Prosody: qTA pitch targets, stress affecting duration, Rd and articulation; question and statement contours | Blind A/B, F0 against recordings |
| V5 | Optimisation against recordings (mel and formant distance, evolutionary search) | Held-out ARCTIC prompts |

Known limits of V1:

- Its articulation is still the formant model's locus-and-target tables.
- The program is long (about 10 KB per sentence; roughly half is the instrument, which V2 can
  share between utterances).
- It has not yet been checked by ear on strudel.cc itself. All tests use `@strudel/web` 1.3, the
  same engine.
