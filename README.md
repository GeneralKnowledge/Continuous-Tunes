# Evolutionary Strudel Music System

A browser prototype of an **autonomous generative music system**. Music is a structured genome that mutates, gets scored by simple musical heuristics, and plays through [Strudel](https://strudel.cc) in the browser.

This is **not** an AI music generator. No LLM, ML model, backend, auth, or cloud database.

It also speaks: a **Speech** tab synthesises British English with the project's own speech engine (see [Speech](#speech-continuous-speech)).

## Why

Most generative music tools either:
- spit out one-shot patterns, or
- need a neural net / cloud service.

This project is a small **artificial musical ecosystem**: open the page, hit Play, and it plays an endless run of **songs**, like a radio station. Each song has sections (intro, groove, build, drop, breakdown, outro…) and evolves once per section; between songs it evolves further, so the next song is related but new. Interesting mutations survive. Worse ones are occasionally accepted for exploration. Ancestry is remembered (bounded). The music runs indefinitely while the tab is alive.

## Architecture

```
Evolution Engine
       |
       v
  Music Genome
       |
       v
Strudel Compiler   ← ONLY place that knows Strudel syntax
       |
       v
Strudel Player  (@strudel/web: initStrudel / evaluate / hush)
       |
       v
     Audio
```

```
src/
  speech/       Continuous Speech: text → phonemes → prosody → formant synthesis (see below)
  evolution/    engine, mutation, fitness, selection, generation, song, songs
  music/        genome, seeds, channels, personality, form, validation,
                theory (Tonal + MusicTheoryJS), styles, harmony, compose, kits,
                pattern (Tidal-style patterns), motif, generative (Markov, walks,
                L-systems), context, counter, arrange, performance,
                groove-reference (Groove MIDI Dataset statistics)
  strudel/      compiler, player
  analysis/     audio, symbolic and structural measurement (not used by the generator)
  persistence/  session + channel lineage (localStorage; SQLite-ready interface)
  ui/           Shell (Music / Speech tabs), App (music), SpeechPanel
  lib/          deterministic RNG (Mulberry32)
tests/
scripts/evolve-cli.ts, render-songs.ts, record-songs.mjs, query-strudel.mjs
scripts/speech/  say.ts, benchmark.ts, asr_whisper.py (optional), lexicon-node.ts
docs/speech/     speech architecture, research assessment, licensing
scripts/analysis/   collections, reports, comparisons, listening page, GMD statistics
docs/research/      musical-quality audit, audio / groove / structural research, implementation report
```

### Music theory layer

`src/music/theory.ts` is the only module that imports the theory libraries; everything else asks it questions in scale degrees.

- **[Tonal](https://github.com/tonaljs/tonal)** (MIT) is the foundation: mode intervals, diatonic seventh chords (`Mode.seventhChords`), chord types and their intervals, chord detection, and voicing search (`Voicing.search` with dictionaries built per genre).
- **[MusicTheoryJS](https://github.com/Zachacious/MusicTheoryJS)** (ISC) is used selectively where it adds something: voice-leading cost and parallel-fifth/octave detection to choose between voicings, Euclidean rhythms for percussion, arpeggio orders, melodic inversion and diatonic sequences for motif development. Its progression, bassline and melody generators were tried and not adopted: they keep the root in the bass for pads, walk chromatically (the genome stores scale degrees) or don't know the genre.

On top of it:

- `styles.ts`: each genre's **harmony language** (seventh/ninth/eleventh vocabulary, colour chords, voicing kind and range, allowed modes), **groove** (per-step accent maps for kick, snare, hats and percussion, plus push/lay-back feel), bass/kick relationship (`avoid`, `lock`, `free`), fill kinds, arp contours and which sections hold pads.
- `harmony.ts`: the chord of each bar, and voice-led voicings for the whole loop (chosen twice round the loop so the last bar leads smoothly into the first).
- `compose.ts`: bass figures (root, octave, fifth, approach and passing notes, kick dodging), motif-based melodies with statement / sequence / answer / cadence phrases snapped to chord tones, arp patterns, and chord substitution for reharmonising.

### Composition layer (after TidalCycles, isobar and libcantus)

These modules decide *what music exists*; Strudel still plays it.

- `pattern.ts` (TidalCycles): a pattern is a query from a time span (cycles = bars) to the events that start in it. `seq` (with nested tuplets), `fromSteps`, `euclid` (Bjorklund), `stack`, `cat`, `fast`/`slow`, `late`/`early`, `rev`, `every`/`lastOf`/`whenCycle`, `degradeBy`, `sometimesBy`, `someCyclesBy`, `ply`, `off`, `rot`, `iter`, `chooseBy`. Randomness is a hash of seed and onset time, like Tidal's time-seeded `rand`, so the same seed always gives the same events. `toSteps`/`toHits` write a pattern onto the genome grid; `eventsToMini` writes events as weighted mini-notation (`a@6 b@2 …`) for exact tuplets. Seeds use it for polymetric figures (ambient's arpeggio runs in its own 10-step cycle).
- `motif.ts`: motif cells (onset, length, degree) and their development: transposition, inversion, retrograde, retrograde inversion, augmentation, diminution, fragmentation, displacement, extension, contraction, repetition with variation, call and response. `placeCell` lands a transformed cell on the harmony at its head and downbeats (as libcantus's `developMotif` does) so it stays recognisable.
- `generative.ts` (isobar): a Markov chain of order 1–2 with back-off and constraint filters (PMarkov/MarkovLearner), a bounded random walk with weighted steps, gravity and leap recovery (PBrown/PRandomWalk), and L-systems, including isobar's `N + - [ ]` walk for self-similar arpeggio contours.
- `context.ts`: the shared compositional context: chord tones, roots and harmonic tension per bar, kick/snare positions with the groove's accents, where the melody attacks and where it is still sounding, where bass and chords play. Also `noteHolds`, the one place note lengths are computed.
- `counter.ts` (libcantus `generateCounterMelody`): a counter-melody that moves in the melody's gaps and holds, sits under it for the whole of each note, prefers thirds and sixths against it, chord tones on strong beats, stepwise and contrary motion, and imitates the previous phrase a third or sixth lower in bars the melody leaves empty. It is derived material: mutations recompose it whenever melody or harmony change.
- `arrange.ts`: how each section treats its material, per genre (`styles.ts` → `arrange`): augmented or octave-lifted breakdown melodies, fragmented outros, a counter-melody from a given appearance of a highlight (house brings it in on the second drop, trance on the first), role genes (sparse intros, hats doubling through builds), microvariation on a role's second appearance, and builds without bass in genres where the drop should land with it.

### Performance layer (after the Groove MIDI Dataset)

`performance.ts` decides how the parts are *played*: per-hit drum velocity and micro-timing (Strudel `nudge`) from per-position statistics of human drummers (`groove-reference.ts`, generated by `scripts/analysis/groove-gmd.ts` from Magenta's Groove MIDI Dataset, CC BY 4.0), a four-bar phrase shape with the last bar lifted, phrase-end ghost or hat pickups, a bass that punches with or ducks under the kick according to the genre's rule, and KTH-style melodic dynamics (metric accent, long and high notes lean in, phrase ends relax). Each genre's `performance` profile in `styles.ts` sets the depth: lo-fi and folk play like people, trance and minimal like machines with a little velocity life. It is deterministic and applied at compile time, so genomes are unchanged; `compileTimeline(…, { performance: 0 })` plays every hit as written. See `docs/research/groove-analysis.md`.

Each genre in `styles.ts` also carries its own bass vocabulary (one-bar figures phrase variations draw on, after libcantus's lick dictionary), note-length ranges, pattern genes, counter-melody settings and a motif-identity range for the fitness.

## Speech (Continuous Speech)

The **Speech** tab speaks British English text with the project's own synthesiser; music keeps
playing in the Music tab. Text is normalised (numbers, dates, money, abbreviations), looked up in
Britfone (MIT) and CMUdict (BSD, converted to British), syllabified and stressed; Klatt's duration
rules and a British tune model give timing and intonation; a Klatt-style cascade/parallel formant
synthesiser renders it. Voices are validated parameter sets (the speech "genome"), kept apart from
the music genome. No external TTS engine, server or model.

```bash
npx tsx scripts/speech/say.ts "Good morning, how are you?" out.wav
npx tsx scripts/speech/benchmark.ts speech-out/      # 62-item benchmark: WAVs, report, listening page
```

Architecture, evaluation results, data sources and licences: [docs/speech/README.md](docs/speech/README.md).
Which projects were reused or only consulted, and why: [docs/speech/research-assessment.md](docs/speech/research-assessment.md).

## Genome

Structured, serialisable data — not arbitrary JS:

| Field | Meaning |
|-------|---------|
| `tempo` | BPM 60–180 |
| `stepsPerBar` / `bars` | Grid size (8/16 × 2/4/8) |
| `scale` | `{ root: 0–11, mode }` |
| `genre` | optional style id (`house`, `dnb`, …); old genomes without it use the default style |
| `drums` | kick / snare / hihat (+ optional `perc`) boolean steps |
| `bass` / `melody` | scale-degree notes + null rests, octave, optional `gate` (note length as a share of the gap to the next note: 0 = one step, 1 = legato) |
| `chords` | progression, voicing, rhythm, optional per-bar `colors` (`m11`, `sus2`, `7`…), optional `gate` for stab length |
| `arp` | optional arpeggio: chord-tone indices per step + octave |
| `counter` | optional counter-melody (derived from melody and chords, see `counter.ts`) |
| `patterns` | optional pattern genes: Tidal-style transforms on one layer (`degrade`, `ply`, `off`, `nudge`), optionally only on the last of every N bars (`every`) or per event with a probability (`chance`). The compiler plays them with Strudel's own `degradeBy`, `ply`, `sometimesBy`, `off`, `lastOf`, `late`, so a 4-bar loop varies on every pass of a 16-bar section. |
| `activeLayers` | which layers are on (`arp`, `counter` optional) |
| `parameters.swing` | 0–1 |

New fields are optional, so saved genomes from before still load and sound as they did.

**Seeds:** `minimal`, `ambient`, `ambient-2`, `electronic`, `pentatonic`, `house`, `house-2`, `minimal-techno`, `downtempo`, `lofi`, `lofi-2`, `dnb`, `dnb-2`, `trance`, `trance-2`. Channels with several seeds pick one from the RNG seed.

## Evolution

1. Create 5–20 mutant candidates from the current parent
2. Intensity mix ≈ **70% small / 20% moderate / 10% experimental** (personality can bias)
3. Score each with fitness heuristics
4. Prefer better fitness; occasionally accept slightly worse (exploration)
5. **Anti-stagnation:** after N unchanged generations, force-accept the best differing mutant
6. Survivor becomes the next parent; generation index grows forever
7. In-memory history bounded (default last 64 gens)

Same RNG seed ⇒ same lineage (deterministic Mulberry32).

### Mutations (examples)

`AddKickHit`, `RemoveKickHit`, `ToggleSnare`, `ToggleHihat`, `ShiftDrumPattern`,
`ChangeBassRhythm`, `ChangeBassNote`, `ChangeMelodyNote`, `AddMelodyPhrase`,
`ChangeChordRoot`, `ChangeChordVoicing`, `ChangeTempo`, `ChangeScaleRoot`,
`ChangeScaleMode`, `AddLayer`, `RemoveLayer`, `ChangeSwing`, `RestructureLength`,
`ColorChord`, `GhostSnare`, `VaryPercussion`, `ArpContour`, `ArpVariation`, …

Structural mutations work on musical units rather than single steps: **DevelopMotif** rewrites a bar as a development of another bar's phrase (any motif transform, placed on that bar's harmony), **RegenerateMelodyBar** writes a new bar from a second-order Markov chain of the melody's own intervals with another bar's rhythm, **PhraseDensity** thins or extends a phrase, **VaryBassPhrase** re-plays a bar from the genre's bass vocabulary, **ChangeGate** moves note lengths within the genre's range, **Add/Tweak/RemovePatternGene** work on the genre's own transforms, and **ArpLSystem** gives the arpeggio a self-similar contour. Single-step flips are weighted down. The counter-melody follows every change.

Mutations are harmony-aware: bass and melody changes pick chord tones of the bar, a new melody phrase develops the existing motif (repeat, sequence, inversion), a chord change swaps the whole held chord for a related one and moves the bass and melody with it, and mode changes stay inside the genre's modes.

Probabilities live in **mutation config / personality weights**, not hardcoded at call sites.

## Fitness

Evaluates the genome directly (no audio analysis):

- **Harmony:** bass and melody notes on the beat are checked against the chord of their bar (downbeats count double); the progression is scored for common diatonic chords (I ii IV V vi)
- **Density per layer:** each layer has its own target, so a busy melody can't hide behind sparse drums
- **Repetition per layer:** drums should loop, bass grooves repeat in rhythm, melodies vary most
- rhythmic complexity (off-beat hits, same meaning on 8- and 16-step grids), melodic complexity, mostly-stepwise melodies, variety
- **Groove interplay:** bass that dodges the kick (house, techno) or locks to it (lo-fi, downtempo), as the genre wants
- **Musicality** (15% of the score, interpretable checks only): melody bars share the motif's rhythm within the genre's range (`motifIdentity`), the loop's last melody note lands on the harmony, melody sits an octave or so above the bass, a counter-melody answers rather than collides and stays under the melody, note lengths sit in the genre's range, and pattern genes don't wreck the groove (a heavily degraded kick, a pile of genes).
- **Genre style:** each personality has a tempo range, bass/melody octave ranges, a swing ceiling and core layers; leaving them is penalised so channels keep their identity

Scores against personality **sweet spots**. Penalises empty silence, wall-of-sound chaos, and total stasis. Transparent and tunable — not “more complexity = better”.

## Channels (= genres)

UI “Channel” selector. Each channel = seed + personality (which also picks the song form) + sound kit + candidates/gen:

| Channel | Seed | Personality | Sound kit |
|---------|------|-------------|-----------|
| Electronic | electronic | driving | 808 drums, resonant acid bass, plucked square lead |
| House | house, house-2 | groovy | club kick, claps, open hats, organ stabs, round bass |
| Minimal | minimal-techno | sparse | club kick, rimshots, sine sub, echoing dub chords |
| Ambient | ambient, ambient-2 | lush | soft kit, supersaw pads, glassy lead, big reverb |
| Downtempo | downtempo | chill | laid-back kit, FM electric piano, warm bass |
| Folk | pentatonic | folk | acoustic-style kit, plucked lead, finger-picked arp |
| Lo-fi hip hop | lofi, lofi-2 | dusty | dusty 808s, bit-crushed electric piano, sine bass |
| Drum & bass | dnb, dnb-2 | rolling | stretched breakbeat under the drums, growling bass |
| Trance | trance, trance-2 | euphoric | hard kick, rolling bass, supersaw lead and pads |

Sound kits live in `src/music/kits.ts`: drum samples (dirt-samples `bank:index`; never a bare-number bank like `909`, which mini-notation reads as a number), synth voices (waveform, filter, envelope, FM, echo, bitcrush) and a `master` trim that keeps genres at about the same loudness. The compiler turns a kit into Strudel code; `DEFAULT_KIT` reproduces the original sounds.

Each channel persists its own lineage in `localStorage`; a channel whose seed changed gets a `seedVersion`, so its lineage is stored under a new id (`house@v2`) and old saves don't bring back the old sound. Switching resumes that channel. Refresh restores active channel + current genome.

## Songs

With evolution on, Play starts songs. Evolution off plays the current genome as a plain loop.

- **Forms** (`src/music/form.ts`): each personality has a song template, a list of sections with a relative length and an energy level. House and Electronic run about 4½ minutes with builds, drops and a breakdown; Ambient (~7 min) and Downtempo (~6 min) are longer and gentler. Sections are whole 4-bar phrases.
- **Song length** (short / medium / long) scales the template. It replaces the old "evolve every N bars" control.
- **Composing** (`src/evolution/song.ts`): one generation per section boundary, with tempo and key frozen inside a song. Between songs one unrestricted step runs, so tempo or key can change at the handover.
- **Contrast material (B)** (`src/evolution/contrast.ts`): drops, peaks and choruses play a second version of the theme, derived when the song starts: the chord progression rotated by half with a substitution or two, the bass moved to the new roots, and a new melody on the new chord tones that keeps some of the theme's notes as a shared motif. Key, tempo and grid stay the same. Several candidates are tried and the best by fitness and contrast wins; B gets a small variation on each later appearance. B sections have a dashed outline in the song strip.
- **Song score** (`evaluateSong`): contrast between B and the theme, an energy shape that peaks on B and comes back down, and whole-phrase form with an intro and outro. Shown in the log for each song.
- **Energy**: each section renders the same genome at its energy: low energy drops melody, bass and drums; breakdowns drop kick and bass; builds sweep the filter open. Loudness follows energy too (`levelForEnergy`, applied as `.velocity()`): an intro plays about 7.5 dB under a drop, and builds swell up to it.
- **Transitions**: every section change has a lead-in on the section's last bar: a tom fill, a snare roll when the next section is bigger, or a hi-hat riser out of a section with no drums. Builds add rising hi-hats and snare and drop the kick for their last bar; drops, peaks and choruses land on a crash (`cr` from dirt-samples). The song's last section ends without a fill.
- **Timeline** (`compileTimeline`): the current and next song are compiled into one `arrange()` on absolute cycles, so every section and song change happens on the audio clock, not on a JS timer. Each section's loops are defined once as constants and shared by its segments (crash bar, body, fill bar), which keeps the code small. The next song is composed halfway through the current one; the last song is repeated in case the next one is late.
- **Form mutation** (`varyForm`): from the second song on, the form gets one or two changes inside the genre's template: a section a phrase longer or shorter, repeated or left out, or its energy nudged. The intro and outro stay, every build still leads into a drop, peak or chorus, and the length stays within 75–135% of the plan. The log says what changed.
- **Next section / Next song** skip on the next bar: the playing song is cut there (its last bar plays the lead-in fill) and the rest of the song, or the next one, starts. A song that is already queued is used rather than composing another.
- **Song history**: each song that starts is listed with its tempo, key, form, score and form changes (newest first, 30 per channel, kept songs are never dropped). **Keep this song** bookmarks the song's first generation and stars it; **Play from here** goes back to a past song's theme and plays new songs from it, while that generation is still in the lineage history.

## Forever playback

- Genome → Strudel code (`setcps` + `stack(...)`, each layer slowed so one cycle is one bar, then its pattern genes) → `evaluate()`
- Screen **Wake Lock** while music plays
- If `evaluate` fails: hush + retry last good pattern
- Evolution ON flag persists across refresh
- **Browser limit:** leave the tab audible and preferably visible — browsers throttle background tabs

Verified against `@strudel/web@1.3.0`: `initStrudel({ prebake: () => samples('github:tidalcycles/dirt-samples') })`, `evaluate`, `hush`.

## Easy UX extras

- **Now-playing strip** with last mutation + fitness delta ↑/↓
- **Mute layers** (playback only — genome unchanged)
- **Copy genome JSON / Strudel code**
- **Bookmark** a generation (or **Keep this song**) + rewind (within bounded history; rewinding drops the later generations)
- **RNG seed** box reseeds the current lineage's randomness without resetting the genome
- **Anti-plateau:** rising exploration + more experimental mutations as stagnation grows
- **Channel fingerprints** (e.g. House four-on-floor, Ambient sparse drums)

## How to run

```bash
npm install
npm test
npm run typecheck   # app, tests and scripts
npm run lint
npm run evolve 200 42
npm run evolve 100 7 ambient
npm run dev
```

Then open the Vite URL → **Play** → **Start evolution**.

## Deploy with Docker

The app is a static SPA. Docker builds the Vite bundle and serves the static files with busybox `httpd` on port 8080 (no TLS or extra headers — put your own proxy/tunnel in front). Audio still runs in the visitor’s browser (`@strudel/web`); the container only hosts the HTML/JS/CSS.

```bash
# Build & run on port 8080 (override with PORT=…)
docker compose up --build -d

# Or without compose:
docker build -t evolutionary-strudel .
docker run --rm -p 8080:8080 evolutionary-strudel
```

Open `http://your-server:8080` → **Play** → **Start evolution**.

**Notes for production**
- Put this behind your own reverse proxy or tunnel if you want HTTPS / a domain.
- Browsers still fetch dirt-samples from GitHub at runtime — outbound network from clients is required for drums to load.
- State lives in each browser’s `localStorage` (not on the server).

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and the production build on every push and pull request.

## Add a mutation

1. Add an op to `MUTATION_OPS` in `src/evolution/mutation.ts`
2. Set `category` (rhythm/bass/melody/…) and `minIntensity`
3. Return `{ genome, mutationName, description }` or `null` if inapplicable
4. Add a deterministic test in `tests/mutation.test.ts`

## Add a seed

1. Write a factory in `src/music/seeds.ts` with the `seed({...})` builder (genre, progression, voicing, colours, drum templates, bass figures, a handwritten melody, arp)
2. Register in `SEED_NAMES` / `getSeed` / `allSeeds`, and in the channel's `seed` or `seedVariants`; bump the channel's `seedVersion` if its sound changes
3. Cover with validation tests

## Listen to a genre offline

```bash
npx tsx scripts/render-songs.ts out.json 42 short            # one song per channel: theme, form, Strudel code
node scripts/record-songs.mjs out.json recordings/ 280 2      # headless Chromium → mp3 (needs ffmpeg)
```

The recorder taps Strudel's output, so it must warm up every sample first; set `RECORD_ONLY=house,dnb` to record a few channels.

`node scripts/query-strudel.mjs <code.js> 0 16` evaluates compiled code in headless Chromium without audio and prints the events it produces (onset, end, value), to check what the compiler and Strudel's transforms actually play.

## Analyse and compare recordings

```bash
node scripts/analysis/make-collection.mjs recordings/run-a 42,7,2026 short 3   # compose, list events, record, analyse
PERFORMANCE=0 node scripts/analysis/make-collection.mjs recordings/run-b        # same, every hit as written
npx tsx scripts/analysis/compare.ts recordings/run-b recordings/run-a recordings  # comparison.md + blind A/B listening.html
```

Each collection gets a `report.md` / `report.json` with audio measurements (tempo and stability, onsets, BS.1770 loudness, spectrum, key, section and bar similarity), symbolic and structural measurements of the events Strudel plays (MusPy- and Libretto-style), and weakness flags per genre. `NO_AUDIO=1` skips recording. The numbers describe the music and flag things to listen for; they are not a quality score. Method and limits: `docs/research/`.

## Add a channel

1. Add an entry to `CHANNELS` in `src/music/channels.ts`
2. Point at an existing seed + personality (or add a personality in `personality.ts`) and add a kit to `KITS` in `src/music/kits.ts` under the channel id
3. Set `candidatesPerGeneration`; the song form comes from the personality (`SONG_TEMPLATES` in `src/music/form.ts`)

## Persistence

`StorageBackend` abstracts storage. `LocalStorageBackend` is the browser default; `MemoryStorage` is used in tests. A future SQLite adapter can implement the same interface for an ancestry tree without rewriting the evolution core.

## Future roadmap (not implemented)

- SQLite-backed full ancestry tree / branching lineages
- Multi-agent channels competing or collaborating
- Optional LLM later — for naming / critique only, never as the music engine

## License

Prototype code: MIT-style freedom for this repo’s sources.  
`@strudel/web` is AGPL-3.0 — respect that if you redistribute a bundled build.  
Speech data: Britfone (MIT) and the CMU Pronouncing Dictionary (BSD-style); their licences ship at `public/licenses/speech-data.txt`.
`@strudel/web` is AGPL-3.0 — respect that if you redistribute a bundled build.
`src/music/groove-reference.ts` holds aggregate statistics of the Groove MIDI Dataset (Gillick et al. 2019, CC BY 4.0); keep its attribution.
