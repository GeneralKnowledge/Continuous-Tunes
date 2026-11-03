# Audio analysis

How Continuous-Tunes now measures the music it actually renders, why that is plain TypeScript rather than Essentia.js, and what the measurements can and can't tell.

## Approach

1. **Record** each song through the real Strudel pipeline in headless Chromium (`scripts/record-songs.mjs`, unchanged: real time, dirt-samples, worklet synths, reverb). The resulting MP3s are the same audio a listener gets.
2. **Decode** with ffmpeg to mono 22.05 kHz float (`scripts/analysis/analyze.ts`).
3. **Analyse** with `src/analysis/audio.ts`: about 400 lines of dependency-free TypeScript that runs in Node or a browser. A 2.7-minute song takes about 1.7 s.
4. **Place it in the song**: section boundaries come from the song's form and tempo, offset by the recording's measured start, so each section and each bar can be measured on its own.

## Essentia.js evaluation

| Question | Finding |
|---|---|
| Compatible? | Yes. `essentia.js@0.1.3` loads in Node 22 (`require('essentia.js')`, Emscripten WASM) and in browsers. In a proof of concept on a house recording, `RhythmExtractor2013` gave 121.98 BPM (written 122) and `KeyExtractor` gave E♭ major (the song is F dorian, the same pitch set). |
| Size | 9.8 MB installed; the core is a 2.0 MB `.wasm` plus a 2.6 MB JS glue file. Model and plot add-ons are extra. |
| Performance | `RhythmExtractor2013` (multifeature) takes about 12.5 s for 2.7 min of 44.1 kHz audio on this machine; `KeyExtractor` takes 0.7 s. That is fine offline, heavy in a page. |
| API stability | The README warns that it is "under rapid development… backwards compatibility is not yet guaranteed". 0.1.3 is the latest release, and some algorithms need typed stereo vectors (`LoudnessEBUR128` failed with mono input). |
| Licence | **AGPL-3.0** (the repository badge and licence file; the README defers to Essentia's licensing page, which offers a commercial licence from UPF/MTG). |

### What AGPL-3.0 would mean here

The app already depends on AGPL code: `@strudel/web` and `@strudel/core` are AGPL-3.0-or-later (the README says so). Continuous-Tunes is served to the internet through the owner's proxy, so **the deployed app already carries AGPL §13 obligations**: it must offer users who interact with it over the network the complete source of the combined work. Essentia.js wouldn't change the category of obligation. The consequences of adopting it are narrower:

- **In the app bundle**: no new kind of obligation beyond Strudel's, but 2 MB of WASM plus glue, and the main-thread cost of analysis, for a feature the player doesn't need. Live audio analysis isn't part of this milestone.
- **In the analysis code**: the analysis modules (`src/analysis/`) are independent of Strudel. Kept free of AGPL imports, they stay usable under the repository's own MIT-style terms: in other tools, in tests, or if the player ever moves off Strudel. Importing Essentia.js would tie them to AGPL like the player.
- **As a devDependency for scripts only**: running AGPL software locally triggers no obligations. But every `npm install` would pull 10 MB for an optional measurement, and the dependency would invite an import into `src/`.
- **Commercial licence**: MTG/UPF offers one. Not needed.

**Decision**: Essentia.js is **not** a dependency, mainly for size, the unstable API and keeping the analysis code licence-clean, not because AGPL is new to the project. The core measurements are re-implemented in TypeScript (`src/analysis/audio.ts`). Essentia.js is kept as an **optional, out-of-tree cross-check** (`scripts/analysis/essentia-crosscheck.mjs`): you install it in a separate folder and point `ESSENTIA_JS` at it. It is a measuring instrument for our own recordings, never imported by the project.

### Alternatives considered

| Option | Licence | Verdict |
|---|---|---|
| Own TypeScript DSP (chosen) | ours | Covers everything below. No dependency, deterministic, runs in Node and browsers, and its formulas are visible. Risk: less battle-tested than Essentia, hence the cross-check. |
| Meyda | MIT | Good per-frame spectral features (centroid, flatness, chroma, MFCC, loudness), but no tempo, beat or key, so a second library would still be needed. Its features are a few lines each once an FFT exists. |
| `web-audio-beat-detector`, `music-tempo` | MIT | Tempo only. |
| librosa, madmom | ISC, BSD (madmom's models are CC BY-NC-SA) | Python. Used as references for technique only: spectral-flux onset strength with a moving-median threshold (librosa's `onset_strength` and `peak_pick`), and onset-envelope autocorrelation for tempo (librosa's `tempo`). madmom's RNN beat tracker would be better than the autocorrelation, but needs Python and non-commercial models. |
| Python Essentia or a separate analysis service | AGPL / service | Ruled out by the brief: no Python runtime, no external service. |

## Measurements

| Measurement | How | Use |
|---|---|---|
| Tempo, pulse clarity | autocorrelation of the onset envelope, 60–200 BPM, mild prior around 120 to settle half/double; octave errors folded against the written tempo before comparing | does the audio carry the intended pulse? |
| Tempo stability | tempo re-estimated in 12 s windows; their spread | a pulse that wanders or gets lost in a section |
| Onsets, onset rate, accent spread | log-compressed spectral flux, peaks above 1.5 × the moving median (100 ms window), 45 ms minimum gap; CV of onset strengths | rhythmic activity per section; flat vs. accented playing |
| Grid timing | spread (ms) of onsets around the song's 16th grid | whether micro-timing is audible in the mix |
| Loudness | ITU-R BS.1770 K-weighting (filters designed for the sample rate), 400 ms gated integrated LUFS, 3 s short-term values, loudness range (10th–95th percentile, EBU Tech 3342 gating); per section too | even levels across channels; the song's dynamic shape |
| Peak, crest, over-full-scale share | sample peak, peak/RMS, share of samples at ±1 or beyond | clipping on fixed-point outputs |
| Spectral centroid, rolloff, flatness | 2048-point Hann FFT, hop 512 | brightness and noisiness; timbral change across the song |
| Band shares | energy in sub (20–60 Hz), bass (60–250), low-mid (250–2 k), high-mid (2–6 k), high (6–11 k) | frequency balance; crude separation of kick and bass from hats and leads |
| Chroma, key | 12-bin chroma (55 Hz–4 kHz), Krumhansl–Kessler profiles | does the audio sound in the written key? |
| Section features and similarity | per section: LUFS, onset rate, centroid, flatness, bands; cosine similarity matrix of section feature vectors | section differentiation in sound, not just in notes |
| Bar self-similarity, bar repetition | feature vector per bar (bands, chroma, RMS, centroid, flux); mean cosine between bars of a section; share of non-adjacent bar pairs above 0.995 | audible looping |

None of these is a quality score. They're compared across genres, seeds and versions, and turned into prompts for listening (`src/analysis/flags.ts`: `tempo-unclear`, `tempo-unstable`, `over-full-scale`, `audio-loop`, `flat-loudness-shape`).

## Limitations

- **No source separation.** Recordings are a stereo mix of every layer, so "instrument" measurements are band proxies: the sub and bass bands hold kick and bass, the high band holds hats. Per-layer facts (who plays when, how loud, with what timing) come from the symbolic side, which reads Strudel's own events and is exact.
- **Tempo resolution** is 0.5 BPM, and the 23 ms hop limits beat-phase precision. A click track at 120 BPM measures 122.5. For tempo stability, this is about whether the pulse holds, not about exact BPM.
- **Grid timing in the mix is blunt.** Reverb, slow attacks and the 23 ms hop smear onsets, so micro-timing of a few ms shows only weakly in `gridSpreadMs`. The symbolic `timingSpreadMs` is the reliable measure of what was played.
- **Key estimation** can't tell modes apart from their relative major or minor (F dorian reads as E♭ major or F minor). Compare pitch sets, not mode names.
- **Recording is real time** (about 30 min for 27 songs at three in parallel) and needs network access to the dirt-samples. If either is unavailable, the symbolic analysis still runs (`NO_AUDIO=1`), and the report says which songs have no audio.

## Running it

```
# one collection: 9 genres × 3 seeds, compose → events → record → analyse
node scripts/analysis/make-collection.mjs recordings/my-run 42,7,2026 short 3
# or analyse an existing one
npx tsx scripts/analysis/analyze.ts recordings/my-run
# optional Essentia cross-check (outside the repo, AGPL)
mkdir -p /tmp/ess && (cd /tmp/ess && npm init -y && npm i essentia.js@0.1.3)
ESSENTIA_JS=/tmp/ess/node_modules/essentia.js node scripts/analysis/essentia-crosscheck.mjs recordings/my-run
```

See [implementation-report.md](implementation-report.md) for the baseline and improved collections and the cross-check results.
