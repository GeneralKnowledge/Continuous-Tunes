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
  type EvolutionState,
} from '../evolution/engine'
import { createContinuousController } from '../evolution/continuous'
import { compileGenome, summarizeGenome } from '../strudel/compiler'
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

const storage = new LocalStorageBackend()

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
  if (existing) return existing
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
  const [evolving, setEvolving] = useState(false)
  const [audioStatus, setAudioStatus] = useState('idle')
  const [barsLeft, setBarsLeft] = useState(0)
  const [wakeLock, setWakeLock] = useState(false)
  const [compiled, setCompiled] = useState(() => compileGenome(state.genome))
  const [log, setLog] = useState<string[]>([])

  const playerRef = useRef(createStrudelPlayer())
  const stateRef = useRef(state)
  stateRef.current = state

  const channel = getChannel(channelId)
  const personality = channelPersonality(channel)

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
      const code = await playerRef.current.playGenome(genome)
      setCompiled(code)
      setPlaying(true)
      setAudioStatus(playerRef.current.status())
    } catch (e) {
      setAudioStatus('error')
      setLog((prev) => [`audio error: ${e instanceof Error ? e.message : String(e)}`, ...prev].slice(0, 20))
    }
  }, [])

  const controllerRef = useRef(
    createContinuousController({
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
        setLog((prev) =>
          [
            `gen ${s.generationIndex}: ${s.lastMutationName} (${s.lastDescription}) fit=${s.fitness.score.toFixed(3)}`,
            ...prev,
          ].slice(0, 20),
        )
        saveChannelState(storage, sessionRef.current.activeChannelId, s)
        if (changed && playerRef.current.isPlaying()) {
          void playerRef.current.playGenome(s.genome).then((code) => setCompiled(code))
        }
        setCompiled(compileGenome(s.genome))
      },
    }),
  )

  // Keep evolve interval in sync
  useEffect(() => {
    controllerRef.current.dispose()
    controllerRef.current = createContinuousController({
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
        setLog((prev) =>
          [
            `gen ${s.generationIndex}: ${s.lastMutationName} (${s.lastDescription}) fit=${s.fitness.score.toFixed(3)}`,
            ...prev,
          ].slice(0, 20),
        )
        saveChannelState(storage, sessionRef.current.activeChannelId, s)
        if (changed && playerRef.current.isPlaying()) {
          void playerRef.current.playGenome(s.genome).then((code) => setCompiled(code))
        }
        setCompiled(compileGenome(s.genome))
      },
    })
    if (evolving) controllerRef.current.start()
    return () => controllerRef.current.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evolveEvery, channelId])

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

  const switchChannel = (id: string) => {
    controllerRef.current.stop()
    setEvolving(false)
    playerRef.current.stop()
    setPlaying(false)
    setChannelId(id)
    const next = bootState(id, rngSeed)
    stateRef.current = next
    setState(next)
    setCompiled(compileGenome(next.genome))
    sessionRef.current = { ...sessionRef.current, activeChannelId: id, evolutionRunning: false }
    saveSession(storage, sessionRef.current)
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
    controllerRef.current.start()
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
    setCompiled(compileGenome(next.genome))
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
    setCompiled(compileGenome(next.genome))
    setLog([])
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
    setLog([])
  }

  const m = state.fitness.metrics

  return (
    <div className="app">
      <header>
        <h1>Evolutionary Strudel</h1>
        <p className="tagline">Autonomous generative music — genome → mutate → select → play</p>
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
        <button type="button" onClick={onResetChannel}>
          Reset channel
        </button>
        <button type="button" onClick={onClearAll}>
          Clear all
        </button>
      </section>

      <section className="status">
        <div>Audio: {audioStatus}</div>
        <div>Evolution: {evolving ? 'ON' : 'OFF'}</div>
        <div>Bars left: {barsLeft}</div>
        <div>Wake lock: {wakeLock ? 'active' : 'off'}</div>
        <div>Stagnation streak: {state.stagnationStreak}</div>
        <div>Generation: {state.generationIndex}</div>
        <div>Tempo: {state.genome.tempo} BPM</div>
        <div>
          Scale: {state.genome.scale.root} / {state.genome.scale.mode}
        </div>
        <div>Fitness: {state.fitness.score.toFixed(3)}</div>
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
          Tip: leave this tab audible for long runs. True multi-day daemons need Electron/Tauri —
          browsers throttle background tabs.
        </p>
      </footer>
    </div>
  )
}
