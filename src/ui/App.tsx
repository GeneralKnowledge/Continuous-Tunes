import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CHANNELS,
  channelPersonality,
  channelSeed,
  channelSongTemplate,
  getChannel,
} from '../music/channels'
import { SECTION_LABELS, SONG_LENGTHS, type SectionRole, type SongLength } from '../music/form'
import {
  createEvolutionState,
  rewindToGeneration,
  setBookmark,
  stepGeneration,
  type EvolutionState,
} from '../evolution/engine'
import { evaluateFitness } from '../evolution/fitness'
import { createSongController, type NowPlaying, type SongController } from '../evolution/songs'
import { compileGenome, summarizeGenome, type LayerMutes } from '../strudel/compiler'
import { createStrudelPlayer } from '../strudel/player'
import {
  LocalStorageBackend,
  clearAll,
  clearChannel,
  loadChannelState,
  loadSession,
  saveChannelState,
  saveSession,
  type AppSession,
} from '../persistence/session'
import { serializeGenome } from '../music/genome'

const storage = new LocalStorageBackend()

const DEFAULT_MUTES: LayerMutes = {
  drums: false,
  bass: false,
  melody: false,
  chords: false,
}

function defaultSession(): AppSession {
  return {
    version: 1,
    activeChannelId: 'electronic',
    rngSeed: 42,
    songLength: 'medium',
    evolutionRunning: false,
  }
}

function bootState(channelId: string, seed: number): EvolutionState {
  const channel = getChannel(channelId)
  const existing = loadChannelState(storage, channelId)
  if (existing) {
    // Re-score with the current fitness so saved scores from older versions don't skew selection
    const fitness = evaluateFitness(existing.genome, channelPersonality(channel))
    return {
      ...existing,
      fitness,
      previousFitness: fitness.score,
      bookmarkIndex: existing.bookmarkIndex ?? null,
    }
  }
  return createEvolutionState(channelSeed(channel), seed, {
    personality: channelPersonality(channel),
    channelId,
    config: { candidatesPerGeneration: channel.candidatesPerGeneration },
  })
}

function MetricBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <div className="metric-track">
        <div className="metric-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="metric-val">{value.toFixed(2)}</span>
    </div>
  )
}

function formatDelta(delta: number): string {
  if (Math.abs(delta) < 0.0005) return '±0'
  return `${delta > 0 ? '↑' : '↓'}${Math.abs(delta).toFixed(3)}`
}

async function copyText(label: string, text: string): Promise<string> {
  try {
    await navigator.clipboard.writeText(text)
    return `copied ${label}`
  } catch {
    return `copy failed (${label})`
  }
}

export function App() {
  const [initialSession] = useState<AppSession>(() => loadSession(storage) ?? defaultSession())
  const sessionRef = useRef(initialSession)
  const [channelId, setChannelId] = useState(initialSession.activeChannelId)
  const [rngSeed, setRngSeed] = useState(initialSession.rngSeed)
  const [songLength, setSongLength] = useState<SongLength>(initialSession.songLength)
  const [state, setState] = useState<EvolutionState>(() =>
    bootState(initialSession.activeChannelId, initialSession.rngSeed),
  )
  const [playing, setPlaying] = useState(false)
  const [evolving, setEvolving] = useState(initialSession.evolutionRunning)
  const [audioStatus, setAudioStatus] = useState('idle')
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null)
  const [wakeLock, setWakeLock] = useState(false)
  const [mutes, setMutes] = useState<LayerMutes>({ ...DEFAULT_MUTES })
  const [compiled, setCompiled] = useState(() => compileGenome(state.genome))
  const [log, setLog] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)

  const playerRef = useRef(createStrudelPlayer())
  const stateRef = useRef(state)
  const mutesRef = useRef(mutes)
  const songLengthRef = useRef(songLength)
  useLayoutEffect(() => {
    stateRef.current = state
    mutesRef.current = mutes
    songLengthRef.current = songLength
  }, [state, mutes, songLength])

  const channel = getChannel(channelId)
  const personality = channelPersonality(channel)
  const fitnessDelta = state.fitness.score - state.previousFitness

  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 1800)
  }

  const addLog = (line: string) => setLog((prev) => [line, ...prev].slice(0, 20))

  const persist = useCallback(
    (next: EvolutionState, sess?: Partial<AppSession>) => {
      saveChannelState(storage, channelId, next)
      const session: AppSession = {
        ...sessionRef.current,
        activeChannelId: channelId,
        rngSeed,
        songLength,
        evolutionRunning: evolving,
        ...sess,
      }
      sessionRef.current = session
      saveSession(storage, session)
    },
    [channelId, rngSeed, songLength, evolving],
  )

  const reportAudioError = useCallback((e: unknown) => {
    setAudioStatus('error')
    setLog((prev) =>
      [`audio error: ${e instanceof Error ? e.message : String(e)}`, ...prev].slice(0, 20),
    )
  }, [])

  /** Play the current genome as a plain loop (evolution off). */
  const refreshAudio = useCallback(async (genome = stateRef.current.genome) => {
    try {
      const result = await playerRef.current.playGenome(genome, mutesRef.current)
      setCompiled(result.code)
      setPlaying(true)
      setAudioStatus(playerRef.current.status())
      if (result.recovered) {
        flash('evaluate failed — restored last good pattern')
        setLog((prev) => ['audio: recovered last good genome', ...prev].slice(0, 20))
      }
    } catch (e) {
      reportAudioError(e)
    }
  }, [reportAudioError])

  // Created once; reads everything that changes through refs
  const makeSongs = useCallback(
    () =>
      createSongController({
        getState: () => stateRef.current,
        setState: (s) => {
          stateRef.current = s
          setState(s)
        },
        now: () => playerRef.current.now(),
        play: (code) =>
          playerRef.current.playCode(code).then((r) => {
            setCompiled(r.code)
            if (r.recovered) flash('evaluate failed — restored last good pattern')
          }),
        template: () => channelSongTemplate(getChannel(sessionRef.current.activeChannelId)),
        length: () => songLengthRef.current,
        personality: () => channelPersonality(getChannel(sessionRef.current.activeChannelId)),
        config: () => ({
          candidatesPerGeneration: getChannel(sessionRef.current.activeChannelId)
            .candidatesPerGeneration,
        }),
        mutes: () => mutesRef.current,
        onComposed: (song, s) => {
          const bars = song.sections.reduce((a, x) => a + x.bars, 0)
          setLog((prev) =>
            [
              `song ${song.number}: ${song.sections.length} sections, ${bars} bars, gens ${song.startGeneration}–${s.generationIndex}, fit=${s.fitness.score.toFixed(3)}`,
              ...prev,
            ].slice(0, 20),
          )
          saveChannelState(storage, sessionRef.current.activeChannelId, s)
        },
        onError: (e) => reportAudioError(e),
      }),
    [reportAudioError],
  )
  const songsRef = useRef<SongController | null>(null)
  // Built on first use (from an effect or handler), never during render
  const songs = useCallback(() => (songsRef.current ??= makeSongs()), [makeSongs])

  useEffect(() => () => songs().dispose(), [songs])

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowPlaying(songs().nowPlaying())
      setAudioStatus(playerRef.current.status())
    }, 400)
    return () => clearInterval(id)
  }, [songs])

  // Keep the screen awake while music plays
  useEffect(() => {
    if (!playing || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false
    const request = () => {
      navigator.wakeLock
        .request('screen')
        .then((s) => {
          if (cancelled) void s.release()
          else {
            sentinel = s
            setWakeLock(true)
            s.addEventListener('release', () => setWakeLock(false))
          }
        })
        .catch(() => setWakeLock(false))
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && sentinel === null) request()
    }
    request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release()
      setWakeLock(false)
    }
  }, [playing])

  useEffect(() => {
    persist(state)
  }, [state, persist])

  // Re-send the music when mutes change
  useEffect(() => {
    if (songs().isRunning()) {
      songs().refresh()
      return
    }
    const code = compileGenome(stateRef.current.genome, mutes)
    setCompiled(code)
    if (playerRef.current.isPlaying()) {
      void playerRef.current.playCode(code).catch(reportAudioError)
    }
  }, [mutes, reportAudioError, songs])

  /** Start songs (evolution on) or the plain loop (evolution off). */
  const startMusic = async (withSongs: boolean) => {
    songs().stop()
    if (!withSongs) {
      await refreshAudio()
      return
    }
    try {
      await playerRef.current.init()
      songs().start()
      setPlaying(true)
    } catch (e) {
      reportAudioError(e)
    }
  }

  const stopMusic = () => {
    songs().stop()
    playerRef.current.stop()
    setPlaying(false)
    setNowPlaying(null)
  }

  const switchChannel = (id: string) => {
    stopMusic()
    setChannelId(id)
    const next = bootState(id, rngSeed)
    stateRef.current = next
    setState(next)
    setCompiled(compileGenome(next.genome, mutesRef.current))
    setMutes({ ...DEFAULT_MUTES })
    sessionRef.current = { ...sessionRef.current, activeChannelId: id }
    saveSession(storage, sessionRef.current)
  }

  /** New seed reseeds the current lineage's RNG; the genome itself is kept. */
  const onSeedChange = (seed: number) => {
    setRngSeed(seed)
    const next = { ...stateRef.current, rngSeed: seed, rngState: seed >>> 0 }
    stateRef.current = next
    setState(next)
  }

  const onPlay = async () => {
    await startMusic(evolving)
  }

  const onPause = () => {
    stopMusic()
    setAudioStatus(playerRef.current.status())
  }

  const onStartEvolution = () => {
    setEvolving(true)
    sessionRef.current = { ...sessionRef.current, evolutionRunning: true }
    saveSession(storage, sessionRef.current)
    if (playing) void startMusic(true)
  }

  const onStopEvolution = () => {
    setEvolving(false)
    sessionRef.current = { ...sessionRef.current, evolutionRunning: false }
    saveSession(storage, sessionRef.current)
    if (playing) void startMusic(false)
  }

  /** Manual edits to the genome play at once in loop mode, or from the next song in song mode. */
  const applyManual = async (next: EvolutionState) => {
    stateRef.current = next
    setState(next)
    if (songs().isRunning()) {
      flash('changes play from the next song')
    } else {
      setCompiled(compileGenome(next.genome, mutesRef.current))
      if (playing) await refreshAudio(next.genome)
    }
  }

  const onMutate = async () => {
    const result = stepGeneration(stateRef.current, {
      personality,
      config: { candidatesPerGeneration: channel.candidatesPerGeneration },
      now: Date.now(),
    })
    const s = result.state
    addLog(
      `gen ${s.generationIndex}: ${s.lastMutationName} (${s.lastDescription}) fit=${s.fitness.score.toFixed(3)} ${formatDelta(result.fitnessDelta)}`,
    )
    await applyManual(s)
  }

  const onResetChannel = () => {
    stopMusic()
    setEvolving(false)
    clearChannel(storage, channelId)
    const next = createEvolutionState(channelSeed(channel), rngSeed, {
      personality,
      channelId,
      config: { candidatesPerGeneration: channel.candidatesPerGeneration },
    })
    stateRef.current = next
    setState(next)
    setCompiled(compileGenome(next.genome, mutesRef.current))
    setLog([])
    sessionRef.current = { ...sessionRef.current, evolutionRunning: false }
    saveSession(storage, sessionRef.current)
  }

  const onClearAll = () => {
    stopMusic()
    setEvolving(false)
    clearAll(storage)
    const sess = defaultSession()
    sessionRef.current = sess
    setChannelId(sess.activeChannelId)
    setRngSeed(sess.rngSeed)
    setSongLength(sess.songLength)
    const next = bootState(sess.activeChannelId, sess.rngSeed)
    stateRef.current = next
    setState(next)
    setCompiled(compileGenome(next.genome))
    setMutes({ ...DEFAULT_MUTES })
    setLog([])
  }

  /** In song mode this keeps the playing song: its first generation is bookmarked. */
  const onBookmark = () => {
    const index = nowPlaying?.song.startGeneration ?? state.generationIndex
    const next = setBookmark(state, index)
    stateRef.current = next
    setState(next)
    flash(
      nowPlaying ? `kept song ${nowPlaying.song.number} (gen ${index})` : `bookmarked gen ${index}`,
    )
  }

  const onRewindBookmark = async () => {
    if (state.bookmarkIndex === null) {
      flash('no bookmark')
      return
    }
    const next = rewindToGeneration(state, state.bookmarkIndex)
    if (!next) {
      flash('bookmark not in history (too old)')
      return
    }
    addLog(`rewound to gen ${next.generationIndex}`)
    await applyManual(next)
  }

  const onRewindPrev = async () => {
    const records = state.history.records
    const prev = records.length >= 2 ? records[records.length - 2] : null
    if (!prev) {
      flash('no previous generation in history')
      return
    }
    const next = rewindToGeneration(state, prev.index)
    if (!next) return
    await applyManual(next)
  }

  const onCopyGenome = async () => {
    flash(await copyText('genome JSON', serializeGenome(state.genome)))
  }

  const onCopyStrudel = async () => {
    flash(await copyText('Strudel', compiled))
  }

  const toggleMute = (layer: keyof LayerMutes) => {
    setMutes((m) => ({ ...m, [layer]: !m[layer] }))
  }

  const m = state.fitness.metrics

  return (
    <div className="app">
      <header>
        <h1>Evolutionary Strudel</h1>
        <p className="tagline">Autonomous generative music — genome → mutate → select → play</p>
        {toast && <p className="toast">{toast}</p>}
      </header>

      <section className="controls">
        <label>
          Channel
          <select value={channelId} onChange={(e) => switchChannel(e.target.value)}>
            {CHANNELS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          RNG seed
          <input
            type="number"
            value={rngSeed}
            onChange={(e) => onSeedChange(Number.parseInt(e.target.value, 10) || 0)}
          />
        </label>

        <label>
          Song length
          <select value={songLength} onChange={(e) => setSongLength(e.target.value as SongLength)}>
            {SONG_LENGTHS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="buttons">
        <button type="button" onClick={() => void onPlay()}>
          Play
        </button>
        <button type="button" onClick={onPause}>
          Pause
        </button>
        <button type="button" onClick={onStartEvolution} disabled={evolving}>
          Start evolution
        </button>
        <button type="button" onClick={onStopEvolution} disabled={!evolving}>
          Stop evolution
        </button>
        <button type="button" onClick={() => void onMutate()}>
          Mutate
        </button>
        <button type="button" onClick={onBookmark}>
          {nowPlaying ? 'Keep this song' : 'Bookmark'}
        </button>
        <button type="button" onClick={() => void onRewindBookmark()}>
          Rewind bookmark
        </button>
        <button type="button" onClick={() => void onRewindPrev()}>
          Rewind prev
        </button>
        <button type="button" onClick={() => void onCopyGenome()}>
          Copy genome
        </button>
        <button type="button" onClick={() => void onCopyStrudel()}>
          Copy Strudel
        </button>
        <button type="button" onClick={onResetChannel}>
          Reset channel
        </button>
        <button type="button" onClick={onClearAll}>
          Clear all
        </button>
      </section>

      <section className="mutes">
        <span className="mutes-label">Mute layers</span>
        {(['drums', 'bass', 'melody', 'chords'] as const).map((layer) => (
          <label key={layer} className="mute-toggle">
            <input
              type="checkbox"
              checked={Boolean(mutes[layer])}
              onChange={() => toggleMute(layer)}
            />
            {layer}
          </label>
        ))}
      </section>

      <section className="song">
        {nowPlaying ? (
          <>
            <strong>
              Song {nowPlaying.song.number} ·{' '}
              {
                SECTION_LABELS[
                  nowPlaying.song.sections[nowPlaying.position.sectionIndex]!.role as SectionRole
                ]
              }{' '}
              · {nowPlaying.position.barsLeftInSection} bars left
            </strong>
            <ol className="song-strip">
              {nowPlaying.song.sections.map((sec, i) => (
                <li
                  key={i}
                  className={i === nowPlaying.position.sectionIndex ? 'current' : undefined}
                  style={{ flexGrow: sec.bars }}
                  title={`${sec.bars} bars, energy ${sec.energy}${sec.energyEnd !== undefined ? `→${sec.energyEnd}` : ''}`}
                >
                  {SECTION_LABELS[sec.role as SectionRole]}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <span className="song-idle">
            {evolving
              ? 'Press Play to start songs. Each song runs through its sections while the music evolves.'
              : 'Evolution is off: Play loops the current pattern.'}
          </span>
        )}
      </section>

      <section className="now-playing">
        <strong>Now</strong>
        <span>
          gen {state.generationIndex} · {state.lastMutationName}
        </span>
        <span className={fitnessDelta >= 0 ? 'delta-up' : 'delta-down'}>
          fit {state.fitness.score.toFixed(3)} {formatDelta(fitnessDelta)}
        </span>
        <span>{state.lastDescription}</span>
      </section>

      <section className="status">
        <div>Audio: {audioStatus}{playing ? '' : ''}</div>
        <div>Evolution: {evolving ? 'ON' : 'OFF'}</div>
        <div>Song bars left: {nowPlaying ? nowPlaying.position.barsLeftInSong : '–'}</div>
        <div>Wake lock: {wakeLock ? 'active' : 'off'}</div>
        <div>Stagnation streak: {state.stagnationStreak}</div>
        <div>Generation: {state.generationIndex}</div>
        <div>Tempo: {state.genome.tempo} BPM</div>
        <div>
          Scale: {state.genome.scale.root} / {state.genome.scale.mode}
        </div>
        <div>
          Fitness: {state.fitness.score.toFixed(3)}{' '}
          <span className={fitnessDelta >= 0 ? 'delta-up' : 'delta-down'}>
            {formatDelta(fitnessDelta)}
          </span>
        </div>
        <div>Bookmark: {state.bookmarkIndex === null ? 'none' : `gen ${state.bookmarkIndex}`}</div>
        <div>Pattern: {summarizeGenome(state.genome)}</div>
      </section>

      <section className="fitness">
        <h2>Fitness metrics</h2>
        <MetricBar label="repetition" value={m.repetition} />
        <MetricBar label="density" value={m.density} />
        <MetricBar label="rhythmicComplexity" value={m.rhythmicComplexity} />
        <MetricBar label="melodicComplexity" value={m.melodicComplexity} />
        <MetricBar label="harmonicConsistency" value={m.harmonicConsistency} />
        <MetricBar label="variety" value={m.variety} />
      </section>

      <section className="log">
        <h2>Recent mutations</h2>
        <ul>
          {log.length === 0 ? <li>(none yet)</li> : log.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      </section>

      <section className="code">
        <h2>Compiled Strudel</h2>
        <pre>{compiled}</pre>
      </section>

      <footer>
        <p>
          Tip: section and song changes run on the audio clock, so background tabs keep playing in
          time. The next song is prepared halfway through the current one.
        </p>
      </footer>
    </div>
  )
}
