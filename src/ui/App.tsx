import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CHANNELS,
  EVOLVE_BAR_OPTIONS,
  channelPersonality,
  channelSeed,
  getChannel,
  type EvolveBars,
} from '../music/channels'
import {
  createEvolutionState,
  rewindToGeneration,
  setBookmark,
  type EvolutionState,
} from '../evolution/engine'
import { createContinuousController } from '../evolution/continuous'
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
    evolveEveryBars: 8,
    evolutionRunning: false,
  }
}

function bootState(channelId: string, seed: number): EvolutionState {
  const channel = getChannel(channelId)
  const existing = loadChannelState(storage, channelId)
  if (existing) {
    return {
      ...existing,
      previousFitness: existing.previousFitness ?? existing.fitness.score,
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
  const sessionRef = useRef<AppSession>(loadSession(storage) ?? defaultSession())
  const [channelId, setChannelId] = useState(sessionRef.current.activeChannelId)
  const [rngSeed, setRngSeed] = useState(sessionRef.current.rngSeed)
  const [evolveEvery, setEvolveEvery] = useState<EvolveBars>(
    sessionRef.current.evolveEveryBars as EvolveBars,
  )
  const [state, setState] = useState<EvolutionState>(() =>
    bootState(sessionRef.current.activeChannelId, sessionRef.current.rngSeed),
  )
  const [playing, setPlaying] = useState(false)
  const [evolving, setEvolving] = useState(sessionRef.current.evolutionRunning)
  const [audioStatus, setAudioStatus] = useState('idle')
  const [barsLeft, setBarsLeft] = useState(0)
  const [wakeLock, setWakeLock] = useState(false)
  const [mutes, setMutes] = useState<LayerMutes>({ ...DEFAULT_MUTES })
  const [compiled, setCompiled] = useState(() => compileGenome(state.genome))
  const [log, setLog] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)

  const playerRef = useRef(createStrudelPlayer())
  const stateRef = useRef(state)
  const mutesRef = useRef(mutes)
  stateRef.current = state
  mutesRef.current = mutes

  const channel = getChannel(channelId)
  const personality = channelPersonality(channel)
  const fitnessDelta = state.fitness.score - state.previousFitness

  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 1800)
  }

  const persist = useCallback(
    (next: EvolutionState, sess?: Partial<AppSession>) => {
      saveChannelState(storage, channelId, next)
      const session: AppSession = {
        ...sessionRef.current,
        activeChannelId: channelId,
        rngSeed,
        evolveEveryBars: evolveEvery,
        evolutionRunning: evolving,
        ...sess,
      }
      sessionRef.current = session
      saveSession(storage, session)
    },
    [channelId, rngSeed, evolveEvery, evolving],
  )

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
      setAudioStatus('error')
      setLog((prev) =>
        [`audio error: ${e instanceof Error ? e.message : String(e)}`, ...prev].slice(0, 20),
      )
    }
  }, [])

  const makeController = useCallback(() => {
    return createContinuousController({
      evolveEveryBars: evolveEvery,
      getTempo: () => stateRef.current.genome.tempo,
      getState: () => stateRef.current,
      setState: (s) => {
        stateRef.current = s
        setState(s)
      },
      personality: () => channelPersonality(getChannel(sessionRef.current.activeChannelId)),
      config: () => ({
        candidatesPerGeneration: getChannel(sessionRef.current.activeChannelId)
          .candidatesPerGeneration,
      }),
      onEvolved: (s, changed) => {
        const delta = s.fitness.score - s.previousFitness
        setLog((prev) =>
          [
            `gen ${s.generationIndex}: ${s.lastMutationName} (${s.lastDescription}) fit=${s.fitness.score.toFixed(3)} ${formatDelta(delta)}`,
            ...prev,
          ].slice(0, 20),
        )
        saveChannelState(storage, sessionRef.current.activeChannelId, s)
        const code = compileGenome(s.genome, mutesRef.current)
        setCompiled(code)
        if (changed && playerRef.current.isPlaying()) {
          void playerRef.current.playGenome(s.genome, mutesRef.current).then((r) => {
            setCompiled(r.code)
            if (r.recovered) flash('evaluate failed — restored last good pattern')
          })
        }
      },
    })
  }, [evolveEvery])

  const controllerRef = useRef(makeController())

  useEffect(() => {
    controllerRef.current.dispose()
    controllerRef.current = makeController()
    if (evolving) controllerRef.current.start()
    return () => controllerRef.current.dispose()
  }, [makeController, evolving, channelId])

  // Resume evolution flag from session (controller starts via effect above)
  useEffect(() => {
    if (sessionRef.current.evolutionRunning) {
      setEvolving(true)
    }
    // once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      setBarsLeft(controllerRef.current.getBarsRemaining())
      setWakeLock(controllerRef.current.getWakeLockActive())
      setAudioStatus(playerRef.current.status())
    }, 400)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    persist(state)
  }, [state, persist])

  // Recompile when mutes change; refresh audio if playing
  useEffect(() => {
    const code = compileGenome(stateRef.current.genome, mutes)
    setCompiled(code)
    if (playerRef.current.isPlaying()) {
      void playerRef.current.playCode(code)
    }
  }, [mutes])

  const switchChannel = (id: string) => {
    const wasEvolving = evolving
    controllerRef.current.stop()
    setEvolving(false)
    playerRef.current.stop()
    setPlaying(false)
    setChannelId(id)
    const next = bootState(id, rngSeed)
    stateRef.current = next
    setState(next)
    setCompiled(compileGenome(next.genome, mutesRef.current))
    setMutes({ ...DEFAULT_MUTES })
    sessionRef.current = {
      ...sessionRef.current,
      activeChannelId: id,
      evolutionRunning: wasEvolving,
    }
    saveSession(storage, sessionRef.current)
    if (wasEvolving) setEvolving(true)
  }

  const onPlay = async () => {
    await refreshAudio()
  }

  const onPause = () => {
    playerRef.current.stop()
    setPlaying(false)
    setAudioStatus(playerRef.current.status())
  }

  const onStartEvolution = () => {
    setEvolving(true)
    sessionRef.current = { ...sessionRef.current, evolutionRunning: true }
    saveSession(storage, sessionRef.current)
  }

  const onStopEvolution = () => {
    setEvolving(false)
    controllerRef.current.stop()
    sessionRef.current = { ...sessionRef.current, evolutionRunning: false }
    saveSession(storage, sessionRef.current)
  }

  const onMutate = async () => {
    const next = controllerRef.current.mutateOnce()
    setCompiled(compileGenome(next.genome, mutesRef.current))
    if (playing) await refreshAudio(next.genome)
  }

  const onResetChannel = () => {
    controllerRef.current.stop()
    setEvolving(false)
    playerRef.current.stop()
    setPlaying(false)
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
    controllerRef.current.stop()
    setEvolving(false)
    playerRef.current.stop()
    setPlaying(false)
    clearAll(storage)
    const sess = defaultSession()
    sessionRef.current = sess
    setChannelId(sess.activeChannelId)
    setRngSeed(sess.rngSeed)
    setEvolveEvery(sess.evolveEveryBars as EvolveBars)
    const next = bootState(sess.activeChannelId, sess.rngSeed)
    stateRef.current = next
    setState(next)
    setCompiled(compileGenome(next.genome))
    setMutes({ ...DEFAULT_MUTES })
    setLog([])
  }

  const onBookmark = () => {
    const next = setBookmark(state, state.generationIndex)
    stateRef.current = next
    setState(next)
    flash(`bookmarked gen ${state.generationIndex}`)
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
    stateRef.current = next
    setState(next)
    setCompiled(compileGenome(next.genome, mutesRef.current))
    setLog((prev) => [`rewound to gen ${next.generationIndex}`, ...prev].slice(0, 20))
    if (playing) await refreshAudio(next.genome)
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
    stateRef.current = next
    setState(next)
    setCompiled(compileGenome(next.genome, mutesRef.current))
    if (playing) await refreshAudio(next.genome)
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
            onChange={(e) => setRngSeed(Number.parseInt(e.target.value, 10) || 0)}
          />
        </label>

        <label>
          Evolve every N bars
          <select
            value={evolveEvery}
            onChange={(e) => setEvolveEvery(Number(e.target.value) as EvolveBars)}
          >
            {EVOLVE_BAR_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
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
          Bookmark
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
        <div>Bars left: {barsLeft}</div>
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
        <div>
          Bookmark: {state.bookmarkIndex === null ? 'none' : `gen ${state.bookmarkIndex}`}
        </div>
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
          Tip: leave this tab audible for long runs. Browsers throttle background tabs — keep the
          page visible if you want continuous evolution.
        </p>
      </footer>
    </div>
  )
}
