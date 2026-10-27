# Evolutionary Strudel Music System

A browser prototype of an **autonomous generative music system**. Music is a structured genome that mutates, gets scored by simple musical heuristics, and plays through [Strudel](https://strudel.cc) in the browser.

This is **not** an AI music generator. No LLM, ML model, backend, auth, or cloud database.

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
  evolution/    engine, mutation, fitness, selection, generation, song, songs
  music/        genome, seeds, channels, personality, form, validation
  strudel/      compiler, player
  persistence/  session + channel lineage (localStorage; SQLite-ready interface)
  ui/           App
  lib/          deterministic RNG (Mulberry32)
tests/
scripts/evolve-cli.ts
```

## Genome

Structured, serialisable data — not arbitrary JS:

| Field | Meaning |
|-------|---------|
| `tempo` | BPM 60–180 |
| `stepsPerBar` / `bars` | Grid size (8/16 × 2/4/8) |
| `scale` | `{ root: 0–11, mode }` |
| `drums` | kick / snare / hihat boolean steps |
| `bass` / `melody` | scale-degree notes + null rests, octave |
| `chords` | progression, voicing, rhythm |
| `activeLayers` | which layers are on |
| `parameters.swing` | 0–1 |

**Seeds:** `minimal`, `ambient`, `electronic`, `pentatonic`.

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
`ChangeScaleMode`, `AddLayer`, `RemoveLayer`, `ChangeSwing`, `RestructureLength`, …

Probabilities live in **mutation config / personality weights**, not hardcoded at call sites.

## Fitness

Evaluates the genome directly (no audio analysis):

- **Harmony:** bass and melody notes on the beat are checked against the chord of their bar (downbeats count double); the progression is scored for common diatonic chords (I ii IV V vi)
- **Density per layer:** each layer has its own target, so a busy melody can't hide behind sparse drums
- **Repetition per layer:** drums should loop, bass grooves repeat in rhythm, melodies vary most
- rhythmic complexity (off-beat hits, same meaning on 8- and 16-step grids), melodic complexity, mostly-stepwise melodies, variety
- **Genre style:** each personality has a tempo range, bass/melody octave ranges, a swing ceiling and core layers; leaving them is penalised so channels keep their identity

Scores against personality **sweet spots**. Penalises empty silence, wall-of-sound chaos, and total stasis. Transparent and tunable — not “more complexity = better”.

## Channels (= genres)

UI “Channel” selector. Each channel = seed + personality (which also picks the song form) + sound kit + candidates/gen:

| Channel | Seed | Personality | Sound kit |
|---------|------|-------------|-----------|
| Electronic | electronic | driving | 808 drums, resonant acid bass, plucked square lead |
| House | house | groovy | club kick, claps, open hats, organ stabs, round bass |
| Minimal | minimal-techno | sparse | club kick, rimshots, sine sub, echoing dub chords |
| Ambient | ambient | lush | soft kit, supersaw pads, glassy lead, big reverb |
| Downtempo | downtempo | chill | laid-back kit, FM electric piano, warm bass |
| Folk | pentatonic | folk | acoustic-style kit, plucked lead, strummed chords |
| Lo-fi hip hop | lofi | dusty | dusty 808s, bit-crushed electric piano, sine bass |
| Drum & bass | dnb | rolling | stretched breakbeat under the drums, growling bass |
| Trance | trance | euphoric | hard kick, rolling bass, supersaw lead and pads |

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
- **Keep this song** bookmarks the first generation of the playing song.

## Forever playback

- Genome → Strudel code (`setcps` + `stack(...).slow(bars)`, one bar per cycle) → `evaluate()`
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

1. Write a factory in `src/music/seeds.ts` that returns a validated `MusicGenome`
2. Register in `SEED_NAMES` / `getSeed` / `allSeeds`
3. Cover with validation tests

## Add a channel

1. Add an entry to `CHANNELS` in `src/music/channels.ts`
2. Point at an existing seed + personality (or add a personality in `personality.ts`) and add a kit to `KITS` in `src/music/kits.ts` under the channel id
3. Set `candidatesPerGeneration`; the song form comes from the personality (`SONG_TEMPLATES` in `src/music/form.ts`)

## Persistence

`StorageBackend` abstracts storage. `LocalStorageBackend` is the browser default; `MemoryStorage` is used in tests. A future SQLite adapter can implement the same interface for an ancestry tree without rewriting the evolution core.

## Future roadmap (not implemented)

- SQLite-backed full ancestry tree / branching lineages
- Optional audio-analysis fitness (onset density, spectral flatness)
- Multi-agent channels competing or collaborating
- Optional LLM later — for naming / critique only, never as the music engine

## License

Prototype code: MIT-style freedom for this repo’s sources.  
`@strudel/web` is AGPL-3.0 — respect that if you redistribute a bundled build.
