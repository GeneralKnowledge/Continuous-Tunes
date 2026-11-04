# Continuous Speech

A speech synthesis subsystem that lives beside the music system. It turns English text into
British English (Standard Southern British) speech in the browser, with our own front end,
prosody and formant synthesiser. It does not wrap eSpeak, MBROLA or any other TTS engine, needs
no server and no model. See [research-assessment.md](research-assessment.md) for what was
borrowed and why, and [m2-audit-and-plan.md](m2-audit-and-plan.md) for the M2 audit, the wider
research and reuse assessment, the milestone plan and measured results.

## Pipeline

```
text
 │  normalize.ts, numbers.ts      sentences, phrases, words; numbers, dates, money, abbreviations
 ▼
Utterance  (linguistic.ts)        lexicon → morphology → letter rules; weak forms; syllables; stress
 │  lexicon.ts, g2p.ts, syllables.ts, phonemes.ts
 ▼
SpeechPlan (prosody.ts → plan.ts) timed phone segments + pitch targets + word/sentence timing
 │
 ▼
backend (backends/)               formant (Klatt-style) now; diphone/PSOLA in M2
 │
 ▼
samples → audio.ts                WAV, resampling, mixing; Web Audio playback in the UI
```

Everything lives in `src/speech/`; it imports nothing from `src/music` or `src/evolution`, and
music imports nothing from it. The only shared code is `src/lib/rng.ts` (deterministic noise) and
the `StorageBackend` interface (speech settings use their own `continuous-speech:` prefix).

### Linguistic processing
- **Phonemes** (`phonemes.ts`): 21 vowels and 24 consonants of SSB in IPA, with articulatory
  features. All lexicons are converted into this inventory; nothing downstream sees ARPAbet.
- **Normalisation** (`normalize.ts`): cardinals with British "and", ordinals, years
  ("twenty twenty-six"), decimals, money (£, $, €), percentages, times, day/month dates,
  units, abbreviations (Dr., St. as saint or street), initialisms spelled with letter names,
  symbols. `.`, `?`, `!` end sentences; `,` is a minor boundary, `; : — ( )` a clause boundary.
  `*word*` marks emphasis.
- **Pronunciation** (`lexicon.ts`): project words, then Britfone (15,206 headwords), then
  CMUdict (126,046) converted to British. Unknown words go to morphology (plural, past, -ing,
  -ly, -ness, compounds of two known words) and then to letter-to-sound rules. Every word keeps
  all its alternatives and its source.
- **Weak forms**: function words take their unstressed form ("of" /əv/) unless emphasised or
  phrase-final; "the" is /ði/ before a vowel.
- **Syllables** (`syllables.ts`): maximal onset with English onset clusters.

### Prosody
- **Durations**: Klatt's 1979 rules (inherent/minimum durations, phrase-final lengthening,
  non-final and polysyllabic shortening, unstressed shortening, the voicing of the next
  consonant, cluster shortening, aspiration lengthening), scaled by the speaking rate.
- **Pauses**: 180 ms at commas, 300 ms at clause breaks, 500 ms between sentences (scaled by
  the voice's pause scale and rate).
- **Intonation**: a declining baseline per phrase, a peak on each accented syllable (stressed
  syllables of content words) with downstep, a bigger nuclear accent, a fall at statements and
  wh-questions, a low accent and final rise on yes/no questions, a small continuation rise at
  commas, larger accents on emphasised words.

### Shared acoustic representation (`plan.ts`)
`SpeechPlan` = segments (phone, start, duration, stress, accent, syllable role, word and phrase
position) + pitch points + word and sentence timing. It is deliberately small: it is what an
MBROLA `.pho` file holds plus linguistic position. A diphone backend can consume it unchanged.

### Formant backend (`backends/formant/`)
- `targets.ts`: per-phoneme targets. Vowel formants from Deterding (1997) for SSB; consonant
  loci, nasal pole/zero values and frication spectra after Klatt (1980); locus-equation slopes.
- `index.ts`: plan → 5 ms parameter frames. Stops become closure + burst; voiceless stops
  aspirate the start of a following vowel (not after /s/); formants move from a locus blend at
  each consonant/vowel edge to each phone's target; diphthongs glide; short unstressed vowels
  undershoot towards schwa; nasal coupling spreads into neighbouring vowels.
- `klatt.ts`: the synthesiser (M2: Liljencrants–Fant glottal pulse with Rd voice quality,
  jitter, shimmer, flutter and breathiness, radiation folded into the source; cascade with nasal
  pole/zero, five formants and fixed higher poles; parallel frication bands behind a
  per-consonant front-cavity high-pass). Deterministic for a given seed.
- `backends/formant-m1/`: the M1 engine frozen as merged (backend `formant-m1`, voice
  `alder-m1`) for A/B comparison. Do not edit it.

### Voices (`voice.ts`)
A `SpeechVoice` is the speech genome: pitch (base, accent size, declination, question rise,
final fall), timing (rate, pauses, stress lengthening), source (LF Rd, flutter, breathiness,
jitter, shimmer, tilt; open quotient for the M1 backend), tract (formant scale, bandwidth scale, nasality) and articulation
(consonant strength, transition time, coarticulation, aspiration). `validateVoice` clamps every
field to a range that stays intelligible and fixes impossible combinations (peak pitch over
450 Hz, a short vocal tract with a very low pitch, long transitions at high rates). Presets:
Alder (low), Birch (middle), Cedar (high, breathy), Monotone (diagnostic).

## Using it

**In the app:** open the **Speech** tab (music keeps playing in the **Music** tab). Type text,
choose a voice, backend, rate and pitch, then **Speak** or **Download WAV**. The panel shows the
pitch contour over the phone timing and each word's pronunciation; hover a word for its source
and alternatives. Dictionaries load the first time the tab opens (~1 MB gzipped).

**From the command line:**

```bash
npx tsx scripts/speech/say.ts "Good morning, how are you?" out.wav            # voice alder
npx tsx scripts/speech/say.ts "Is it raining?" out.wav cedar 1.2 44100       # voice, rate, sample rate
```

**From code:**

```ts
import { speak, getVoicePreset, encodeWav } from './src/speech'
import { loadLexicon } from './src/speech/lexicon-loader' // browser; scripts/speech/lexicon-node.ts in Node
const r = speak('Hello there.', getVoicePreset('birch'), { lexicon: await loadLexicon() })
const wav = encodeWav(r.samples, r.sampleRate)
```

## Benchmark and evaluation

`src/speech/benchmark.ts` holds 62 fixed items: conversation, short and long sentences,
consonant clusters, 16 minimal pairs in a carrier phrase ("Now say *bat* again."), questions
against statements, numbers/dates/punctuation, unfamiliar words, emphasis, and slow and fast
rates.

```bash
npx tsx scripts/speech/benchmark.ts out/ alder,cedar     # WAVs, report.md/json, listening.html
python3 scripts/speech/asr_whisper.py out/ <whisperModelDir>   # optional, see the script header
npx tsx scripts/speech/benchmark.ts out/ alder,cedar     # again, now with word error rates
```

Measured (`metrics.ts`): speaking rate, stressed/unstressed vowel durations, implausible
segments, f0 range and final slope (questions should rise, statements fall), clipping, NaNs,
DC offset, clicks, voicing in vowels, how closely the audio's pitch follows the plan,
reproducibility (bit-identical re-render), phoneme and diphone coverage, which words were
guessed, letter-to-sound accuracy against Britfone, and ASR word error rate.

**M2 additions.** `--set diagnostic|all` adds 52 consonant-contrast words scored as a closed
set; `--seed n` re-renders with different noise (run three seeds before believing a 2–3 point
difference); a voice can be a JSON file. `asr_whisper.py` takes several model directories
(Whisper base.en/small.en, NeMo Citrinet CTC, Zipformer) and the report shows each, plus
per-phone acoustics against natural ranges. `scripts/speech/ab.ts out/ alder-m1 alder` builds a
blind A/B page; `scripts/speech/experiment.py` runs logged sweeps and CMA-ES searches over voice
fields.

ASR is an auxiliary signal only: Whisper has a strong language model and will "hear" likely
words. The human check is `listening.html`: play, type what you hear, then reveal.

### M1 results (formant backend, voice Alder, 22.05 kHz)

| measure | value |
|---|---|
| ASR word error rate, all items | 27% |
| conversation / short / questions / emphasis | 8% / 0% / 10% / 0% |
| minimal pairs in carrier | 36% |
| speaking rate | 4.5 syllables/s |
| stressed vs unstressed vowels | 156 ms vs 49 ms |
| pitch follows plan (median error) | 0.14 semitones |
| yes/no question end vs statement end | +3.7 vs −6.1 semitones |
| clipping, NaNs, implausible segments | none |
| re-render | bit-identical |
| letter rules vs Britfone | 17.6% phone error rate |

Clips, reports and the listening page for this run are in the project's shared folder under
`recordings/speech/m1/`.

**Known weaknesses** (from the minimal pairs): nasals are sometimes heard as voiced stops
(man → "bad"), weak fricatives /f θ v/ merge with neighbouring words, /k/ vs /t/ and /ʃ/ vs /tʃ/
are confusable, word-final voiceless stops are heard as voiced. It sounds robotic, as formant
synthesis does.

## Data sources and licensing

| Data | Licence | Where |
|---|---|---|
| Britfone 3.0.1 | MIT | npm `britfone`, loaded lazily |
| CMU Pronouncing Dictionary | BSD-2-Clause style | npm `cmu-pronouncing-dictionary` (ISC wrapper), loaded lazily |
| Project words | this repo | `src/speech/custom-lexicon.ts` |
| Formant targets | our approximations of published measurements | `backends/formant/targets.ts` |
| Pink Trombone waveguide | MIT | npm `pink-trombone-mod`, used by the experimental `tract` backend |
| CMU ARCTIC (research only, not shipped) | permissive, attribution | diphones and glottal pulses built offline by `scripts/speech/corpus/` and loaded at runtime |

Both dictionaries' licences are served with the app at `/licenses/speech-data.txt` (linked from
the Speech tab), which their terms require for binary redistribution.

## Roadmap

The hybrid-engine research round (November 2026) compared six engines on the same plans and set
the next milestones H1–H7: see [hybrid-research.md](hybrid-research.md). Two experimental
backends came out of it, `tract` (articulatory waveguide) and `units` (diphones + TD-PSOLA, needs
a unit database), plus recorded excitation (`source.excitation`) for formant voices. Neither
changes the default voice.

Before that, M2 replaced the plan below; see [m2-audit-and-plan.md](m2-audit-and-plan.md) for the current
milestones (M3 formant-coupled bursts and transitions, M4 voice search, M5 prosody, M6
experimental articulatory and diphone backends). The original M1 roadmap is kept for history:

- **M0 foundations** — done.
- **M1 first synthesiser** — done: formant synthesis, WAV, browser playback, benchmark.
- **M2 diphone backend** (next): a diphone database format, unit selection over `SpeechPlan`
  segments, TD-PSOLA for pitch and duration, crossfades at unit joins, and a side-by-side
  comparison with the formant backend on the benchmark. Needs a legally clean British diphone
  corpus: record our own with Festvox-style prompts (see the research assessment).
- **M3 natural prosody**: contextual pronunciation (homographs, linking r), phrase planning
  from syntax, better pauses and emphasis, rate-dependent reduction.
- **M4 evolutionary speech**: mutate `SpeechVoice` and backend parameters, render the benchmark
  per candidate, select on several objectives (ASR WER, listener scores, plan/audio metrics)
  with intelligibility as a hard floor, keep several lineages, log ancestry. Separate from
  `src/evolution` music state; reuse only `Rng` and selection ideas.
- **M5 research**: articulatory synthesis, continuous gestures, learned duration/pitch models,
  small vocoders trained from scratch, only where they beat the above on the benchmark.
