# Speech as Strudel code

The goal: text in, **Strudel code out**, and that code speaks when pasted into the standard
REPL (strudel.cc). Strudel itself makes the sound, from its built-in oscillators, noise and filters.
No samples are loaded and nothing is pre-rendered.

In the app: open the **Speech** tab, type text, press **Copy Strudel**, and paste into strudel.cc.
From code: `compileStrudelSpeech(plan, voice, { text })` in `src/speech/strudel/compile.ts`.

## How it works

The text front end is the one the formant engine uses: pronunciation, stress, timing and pitch,
producing the same `SpeechPlan` and the same 5 ms control frames. The compiler turns those frames
into a parallel formant synthesiser written as Strudel patterns. Each layer is one line of a
`stack(...)`:

| Layer | Strudel | Driven by |
|---|---|---|
| F1–F4 | `freq(f0).s("sawtooth").bpf("F:Q:glide").bpattack(t)` plus fixed `lpf`/`hpf` skirts | formant frequency, bandwidth, voicing, and the cascade filter's gain at each formant |
| nasal murmur | `sawtooth` through `bpf(270)` | the nasal pole/zero pair, only while the velum is open |
| aspiration | `white` through F2 and F3 | aspiration amplitude |
| frication | `white` through the three parallel bands | frication bands and gains |

- The utterance is one cycle (`setcps(1 / seconds)`). It repeats like any pattern.
- Slices are 10 ms. Each layer merges runs of similar slices into one event (`value@n`).
- Pitch moves with Strudel's pitch envelope (`penv` in semitones, `pattack` = event length,
  `panchor(0)`), so f0 glides inside an event instead of stepping between events.
- All voiced layers share one segmentation: an event ends only where some formant, f0 or gain
  stops fitting a straight log glide. Shared bounds let every layer use the same `f0`, `glide` and
  `len` patterns, defined once at the top of the program as constants, with a small `tract(bpf,
  gain)` helper for each formant line. Events last up to 250 ms.
- Gains use one fixed scale for every utterance rather than per-utterance normalisation, so weak
  aspiration is not blown up in quiet sentences.
- Voiced fricatives (z, v, zh, dh) pulse their noise at the voice's pitch with `tremolo(f0)` and
  `tremolodepth`, the glottal modulation of frication from Klatt's synthesiser and the formant engine.
- A Klatt-style bypass noise layer (high-passed white) carries the flat part of s/sh/f spectra.
- Formant movement uses Strudel's filter envelope. `bpf("F:Q:env")` with `bpattack` set to the
  event length, `bpsustain(1)` and a long `bprelease` glides the band-pass from one event's start
  to the next. This gives piecewise-exponential formant tracks instead of steps.

Gotchas found while building it, all checked in a browser:

- An event with an attack but no envelope depth gets Strudel's default depth of +1 octave and
  sweeps upwards. Every event must write its depth.
- A negative depth swaps the envelope ends, so the release phase ramps back to the *upper*
  frequency. With the default 0.1 s filter release, that makes audible upward chirps at every
  event end. A long `bprelease` keeps the filter still while the amplitude fades.
- The sawtooth already falls at 6 dB per octave, the net slope of glottal source plus lip
  radiation. Adding the glottal 1/F tilt again made F2 and F3 inaudible. Without low-pass skirts
  on each layer, the sawtooth's high harmonics leak through every band-pass and give a hiss
  10–16 dB above the formant engine at 3–8 kHz.

## Results

Same 114-item benchmark and four recognisers as every other engine
(`scripts/speech/strudel-compile-plans.ts`, then `strudel-render.mjs`, then
`benchmark.ts --wavs`). Lower is better. The Strudel output is recorded in real time from
headless Chromium with the app's own `@strudel/web`.

| Engine | Whisper base | Whisper small | Citrinet | Zipformer | Mean WER | Diagnostic |
|---|---|---|---|---|---|---|
| Strudel code, round 2 | 40% | 33% | 85% | 60% | 54.4% | 15% |
| Strudel code, first version (PR #18) | 40% | 34% | 80% | 81% | 58.5% | 20% |
| Formant engine (TypeScript) | 17% | 17% | 52% | 32% | 29.7% | 36% |

The round-2 row was measured before the voiced-fricative tremolo was added (the quick subset shows
it as neutral to slightly better). Zipformer improved most (81% to 60%). The diagnostic word score
fell from 20% to 15%, within the noise of 23 diagnostic items across four recognisers.

Development steps on a 41-item subset, Whisper small:

| Version | WER |
|---|---|
| First version (20 ms steps) | 86% |
| No double tilt | 57% |
| Low-/high-pass skirts | 47–52% |
| Filter-envelope glides | 57% |
| Nasal murmur layer | 29% |

Round 2, same subset, Whisper small / Zipformer (the second CTC model is the one that hears event
artefacts most):

| Version | Whisper small | Zipformer |
|---|---|---|
| Nasal murmur layer (PR #18) | 29% | 83% |
| Pitch glides via `penv` | 32% | 76% |
| Shared segmentation across layers | 31% | 76% |
| Fixed gain scale | 27% | 72% |
| Short amplitude crossfades (3 ms attack, 5 ms release) | 28–33% | 62–66% |
| Longer events (up to 250 ms), bypass noise | 33% | 62% |
| Voiced-fricative tremolo | 33% | 60% |

Code went from about 12 KB to about 8 KB per sentence and from 130 to 88 events per second.
Aligning event boundaries to glottal periods made no measurable difference and is off.

An emulator of the same layers in TypeScript, without Strudel's per-event oscillator restarts,
scores 23% / 40% on this subset; with a restart every 10 ms it scores 28% / 51%. Most of the
remaining gap to the formant engine (29% / 42%) is Strudel's event mechanics, not the formant model.

The glides alone showed no gain, within the ±5-point noise of a single run on 41 items. They are
kept because they made the nasal fix measurable and cut events. The formant engine scores 29% on
the same subset.

Whisper understands most sentences. The CTC recognisers (Citrinet, Zipformer) do not. That points
at artefacts a person would also notice: each event restarts its oscillators, and pitch steps
between events.

## Limits and next steps

- **Code size:** about 8 KB and 88 events per second of speech.
- **Oscillator restarts:** still the largest cost (see the emulator numbers above). Strudel starts a
  new oscillator per event; longer events help, but each formant change beyond a straight glide
  still needs a new one.
- **Consonants:** fricative voicing still scores 0% and final voicing 12% on the diagnostic set.
  The tremolo trick did not move the voicing contrasts measurably yet; durations and voice bars
  are the next things to try.
- **Backend:** Copy Strudel always compiles from the formant voice model's frames, whatever
  backend is selected for playback. The button says so.
- **In-app playback through Strudel:** not wired yet. The music player owns the Strudel instance,
  and playing speech through it would stop the music.
- **Sample route (option B):** render the voice with a better engine and have the Strudel code
  play it as samples. This needs a public URL for the audio.
