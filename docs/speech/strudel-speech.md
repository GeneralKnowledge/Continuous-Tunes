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
| Strudel code (this) | 40% | 34% | 80% | 81% | 58.5% | 20% |
| Formant engine (TypeScript) | 17% | 17% | 52% | 32% | 29.7% | 36% |

Development steps on a 41-item subset, Whisper small:

| Version | WER |
|---|---|
| First version (20 ms steps) | 86% |
| No double tilt | 57% |
| Low-/high-pass skirts | 47–52% |
| Filter-envelope glides | 57% |
| Nasal murmur layer | 29% |

The glides alone showed no gain, within the ±5-point noise of a single run on 41 items. They are
kept because they made the nasal fix measurable and cut events. The formant engine scores 29% on
the same subset.

Whisper understands most sentences. The CTC recognisers (Citrinet, Zipformer) do not. That points
at artefacts a person would also notice: each event restarts its oscillators, and pitch steps
between events.

## Limits and next steps

- **Code size:** about 12 KB and 130 events per second of speech. That works in the REPL, but it is
  long to paste. Coarser merging (wider f0 tolerance, pitch glides via `penv`) would shrink it.
- **Oscillator restarts:** Strudel starts a new oscillator per event, so phase resets at every
  event boundary. Longer events through more envelope use, or a pitch envelope instead of steps,
  should reduce the buzz.
- **Consonants:** fricative voicing scores 0% and final voicing 8%. Bursts and voice bars are
  weaker than in the formant engine.
- **In-app playback through Strudel:** not wired yet. The music player owns the Strudel instance,
  and playing speech through it would stop the music.
- **Sample route (option B):** render the voice with a better engine and have the Strudel code
  play it as samples. This needs a public URL for the audio.
