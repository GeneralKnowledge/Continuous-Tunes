# Evolutionary Strudel Music System

A browser prototype of an **autonomous generative music system**. Music is a structured genome that mutates, gets scored by simple musical heuristics, and plays through [Strudel](https://strudel.cc) in the browser.

This is **not** an AI music generator. No LLM, ML model, backend, Docker, auth, or cloud database.

## Why

Most generative music tools either:
- spit out one-shot patterns, or
- need a neural net / cloud service.

This project is a small **artificial musical ecosystem**: open the page, hit Play, and every N bars a mutation is tried. Interesting ones survive. Worse ones are occasionally accepted for exploration. Ancestry is remembered (bounded). The loop runs indefinitely while the tab is alive.

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
  evolution/    engine, mutation, fitness, selection, generation, continuous
  music/        genome, seeds, channels, personality, validation
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

- repetition, density, rhythmicComplexity, melodicComplexity
- harmonicConsistency, variety

Scores against personality **sweet spots**. Penalises empty silence, wall-of-sound chaos, and total stasis. Transparent and tunable — not “more complexity = better”.

## Channels (= genres)

UI “Channel” selector. Each channel = seed + personality + default evolve interval + candidates/gen:

| Channel | Seed | Personality |
|---------|------|-------------|
| Electronic | electronic | driving |
| Ambient | ambient | lush |
| Minimal | minimal | sparse |
| House | electronic | groovy |
| Downtempo | ambient | chill |
| Folk | pentatonic | folk |

Each channel persists its own lineage in `localStorage`. Switching resumes that channel. Refresh restores active channel + current genome.

## Forever playback

- Genome → Strudel code (`setcps` + `stack`) → `evaluate()`
- Evolve every 4 / 8 / 16 / 32 bars
- Deadline-based polling (not fragile per-bar `setInterval` alone)
- Screen **Wake Lock** while evolving
- Re-schedule on `visibilitychange`
- If `evaluate` fails: hush + retry last good pattern
- Evolution ON flag persists across refresh
- **Browser limit:** leave the tab audible and preferably visible — browsers throttle background tabs

Verified against `@strudel/web@1.3.0`: `initStrudel({ prebake: () => samples('github:tidalcycles/dirt-samples') })`, `evaluate`, `hush`.

## Easy UX extras

- **Now-playing strip** with last mutation + fitness delta ↑/↓
- **Mute layers** (playback only — genome unchanged)
- **Copy genome JSON / Strudel code**
- **Bookmark** a generation + rewind (within bounded history)
- **Anti-plateau:** rising exploration + more experimental mutations as stagnation grows
- **Channel fingerprints** (e.g. House four-on-floor, Ambient sparse drums)

## How to run

```bash
npm install
npm test
npm run evolve 200 42
npm run evolve 100 7 ambient
npm run dev
```

Then open the Vite URL → **Play** → **Start evolution**.

## Deploy with Docker

The app is a static SPA. Docker builds the Vite bundle and serves it with nginx. Audio still runs in the visitor’s browser (`@strudel/web`); the container only hosts the HTML/JS/CSS.

```bash
# Build & run on port 8080 (override with PORT=…)
docker compose up --build -d

# Or without compose:
docker build -t evolutionary-strudel .
docker run --rm -p 8080:80 evolutionary-strudel
```

Open `http://your-server:8080` → **Play** → **Start evolution**.

Health check: `GET /healthz` → `ok`

**Notes for production**
- Put this behind your reverse proxy (Caddy / nginx / Traefik) if you want HTTPS / a domain.
- Browsers still fetch dirt-samples from GitHub at runtime — outbound network from clients is required for drums to load.
- State lives in each browser’s `localStorage` (not on the server).

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
2. Point at an existing seed + personality (or add a personality in `personality.ts`)
3. Set `defaultGenerationBars` and `candidatesPerGeneration`

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
