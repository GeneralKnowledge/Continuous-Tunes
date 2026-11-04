import { useEffect, useRef, useState } from 'react'
import { LocalStorageBackend } from '../persistence/session'
import { BACKENDS, encodeWav, getVoicePreset, speak, VOICE_PRESETS, withControls } from '../speech'
import type { SpeechResult } from '../speech'
import { loadLexicon } from '../speech/lexicon-loader'
import type { Lexicon } from '../speech/lexicon'
import { planMetrics } from '../speech/metrics'
import { compileStrudelSpeech } from '../speech/strudel/compile'
import { formatPronunciation } from '../speech/phonemes'
import { PAUSE, type SpeechPlan } from '../speech/plan'
import {
  loadSpeechSettings,
  PITCH_RANGE,
  RATE_RANGE,
  saveSpeechSettings,
  SPEECH_STORAGE_PREFIX,
  type SpeechSettings,
} from '../speech/settings'

const storage = new LocalStorageBackend(SPEECH_STORAGE_PREFIX)

const SOURCE_LABEL: Record<string, string> = {
  britfone: 'Britfone',
  cmudict: 'CMUdict→GB',
  custom: 'project',
  morphology: 'morphology',
  rules: 'letter rules',
  letters: 'spelled',
}

/** f0 contour over the phone segments, as a small SVG. */
function PlanView({ plan }: { plan: SpeechPlan }) {
  const W = 860
  const H = 140
  const top = 10
  const bottom = 104
  const hz = plan.pitch.map((p) => p.hz)
  const lo = Math.min(...hz) * 0.9
  const hi = Math.max(...hz) * 1.1
  const x = (t: number) => (t / plan.duration) * W
  const y = (f: number) => bottom - ((Math.log(f) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (bottom - top)
  const path = plan.pitch.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.hz).toFixed(1)}`).join(' ')
  return (
    <svg className="plan-view" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pitch contour and phone timing">
      {plan.segments.map((s, i) =>
        s.phone === PAUSE ? null : (
          <g key={i}>
            <rect
              x={x(s.start)}
              y={bottom + 4}
              width={Math.max(1, x(s.duration) - 1)}
              height={14}
              className={s.role === 'nucleus' ? (s.stress === 1 ? 'seg seg-stressed' : 'seg seg-vowel') : 'seg'}
            />
            {x(s.duration) > 9 && (
              <text x={x(s.start + s.duration / 2)} y={bottom + 31} textAnchor="middle">
                {s.phone}
              </text>
            )}
          </g>
        ),
      )}
      <path d={path} className="f0" />
      <text x={2} y={top + 8} className="axis">
        {Math.round(hi)} Hz
      </text>
      <text x={2} y={bottom - 2} className="axis">
        {Math.round(lo)} Hz
      </text>
    </svg>
  )
}

export function SpeechPanel() {
  const [settings, setSettings] = useState<SpeechSettings>(() => loadSpeechSettings(storage))
  const [lexicon, setLexicon] = useState<Lexicon | null>(null)
  const [lexError, setLexError] = useState<string | null>(null)
  const [result, setResult] = useState<SpeechResult | null>(null)
  const [renderMs, setRenderMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const resultKey = useRef('')
  const [strudel, setStrudel] = useState<{ key: string; code: string } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadLexicon()
      .then((lex) => alive && setLexicon(lex))
      .catch((e: unknown) => alive && setLexError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => saveSpeechSettings(storage, settings), [settings])

  useEffect(
    () => () => {
      sourceRef.current?.stop()
      void ctxRef.current?.close()
    },
    [],
  )

  const update = (patch: Partial<SpeechSettings>) => setSettings((s) => ({ ...s, ...patch }))

  function render(): SpeechResult | null {
    if (!lexicon) return null
    const key = JSON.stringify(settings)
    if (result && resultKey.current === key) return result
    try {
      const t0 = performance.now()
      const voice = withControls(getVoicePreset(settings.voiceId), { rate: settings.rate, pitch: settings.pitch })
      const r = speak(settings.text, voice, { lexicon, backend: settings.backendId })
      setRenderMs(performance.now() - t0)
      setResult(r)
      setError(null)
      resultKey.current = key
      return r
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }

  function stop() {
    sourceRef.current?.stop()
    sourceRef.current = null
    setPlaying(false)
  }

  async function play() {
    const r = render()
    if (!r || r.samples.length === 0) return
    stop()
    ctxRef.current ??= new AudioContext()
    const ctx = ctxRef.current
    if (ctx.state === 'suspended') await ctx.resume()
    // the context resamples a 22.05 kHz buffer to its own rate
    const buffer = ctx.createBuffer(1, r.samples.length, r.sampleRate)
    buffer.copyToChannel(r.samples as Float32Array<ArrayBuffer>, 0)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.onended = () => {
      if (sourceRef.current === src) {
        sourceRef.current = null
        setPlaying(false)
      }
    }
    sourceRef.current = src
    src.start()
    setPlaying(true)
  }

  function downloadWav() {
    const r = render()
    if (!r) return
    const bytes = encodeWav(r.samples, r.sampleRate)
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }))
    const a = document.createElement('a')
    const slug = settings.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'speech'
    a.href = url
    a.download = `${slug}-${settings.voiceId}.wav`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function copyStrudel() {
    const r = render()
    if (!r) return
    const voice = withControls(getVoicePreset(settings.voiceId), { rate: settings.rate, pitch: settings.pitch })
    const { code } = compileStrudelSpeech(r.plan, voice, { text: settings.text })
    setStrudel({ key: JSON.stringify(settings), code })
    try {
      await navigator.clipboard.writeText(code)
      setCopied('Copied: paste it into strudel.cc and press play')
    } catch {
      setCopied('Copy failed: select the code below and copy it by hand')
    }
  }

  const metrics = result ? planMetrics(result.plan) : null
  const stats = lexicon?.stats()

  return (
    <div className="app speech">
      <header>
        <h1>Continuous Speech</h1>
        <p className="tagline">Text → British English phonemes → prosody → formant synthesis, all in the browser</p>
      </header>

      <section className="speech-input">
        <textarea
          value={settings.text}
          rows={4}
          maxLength={5000}
          onChange={(e) => update({ text: e.target.value })}
          aria-label="Text to speak"
        />
      </section>

      <section className="controls">
        <label>
          Voice
          <select value={settings.voiceId} onChange={(e) => update({ voiceId: e.target.value })}>
            {VOICE_PRESETS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Backend
          <select value={settings.backendId} onChange={(e) => update({ backendId: e.target.value })}>
            {BACKENDS.map((b) => (
              <option key={b.id} value={b.id} title={b.description}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rate ×{settings.rate.toFixed(2)}
          <input
            type="range"
            min={RATE_RANGE[0]}
            max={RATE_RANGE[1]}
            step={0.05}
            value={settings.rate}
            onChange={(e) => update({ rate: Number(e.target.value) })}
          />
        </label>
        <label>
          Pitch ×{settings.pitch.toFixed(2)}
          <input
            type="range"
            min={PITCH_RANGE[0]}
            max={PITCH_RANGE[1]}
            step={0.05}
            value={settings.pitch}
            onChange={(e) => update({ pitch: Number(e.target.value) })}
          />
        </label>
      </section>

      <section className="buttons">
        <button onClick={() => void play()} disabled={!lexicon || !settings.text.trim()}>
          {lexicon ? 'Speak' : 'Loading dictionaries…'}
        </button>
        <button onClick={stop} disabled={!playing}>
          Stop
        </button>
        <button onClick={downloadWav} disabled={!lexicon || !settings.text.trim()}>
          Download WAV
        </button>
        <button
          onClick={() => void copyStrudel()}
          disabled={!lexicon || !settings.text.trim()}
          title="Strudel code that speaks this text with Strudel's own oscillators and filters, for the standard REPL"
        >
          Copy Strudel
        </button>
      </section>

      {strudel && strudel.key === JSON.stringify(settings) && (
        <details className="strudel-speech">
          <summary>{copied ?? 'Strudel code'}</summary>
          <textarea readOnly value={strudel.code} rows={8} aria-label="Strudel code for this text" />
        </details>
      )}

      {lexError && <p className="speech-error">Could not load the dictionaries: {lexError}</p>}
      {error && <p className="speech-error">{error}</p>}

      {result && metrics && (
        <>
          <section className="status">
            <span>length {result.plan.duration.toFixed(2)} s</span>
            <span>{metrics.syllablesPerSecond.toFixed(1)} syllables/s</span>
            <span>
              pitch {Math.round(metrics.f0MinHz)}–{Math.round(metrics.f0MaxHz)} Hz
            </span>
            <span>rendered in {renderMs.toFixed(0)} ms</span>
            <span>{result.plan.segments.length} segments</span>
            <span>
              {result.sampleRate} Hz, {result.backend}
            </span>
          </section>
          {result.voiceIssues.length > 0 && (
            <p className="speech-note">Voice adjusted: {result.voiceIssues.join('; ')}</p>
          )}
          <section className="speech-plan">
            <h2>Pitch and timing</h2>
            <PlanView plan={result.plan} />
          </section>
          <section className="speech-words">
            <h2>Pronunciation</h2>
            {result.utterance.sentences.map((s, si) => (
              <div key={si} className="speech-sentence">
                <div className="speech-sentence-type">
                  {s.type}
                  {s.type === 'question' ? (s.whQuestion ? ' (wh, falling)' : ' (yes/no, rising)') : ''}
                </div>
                {s.phrases.map((p, pi) => (
                  <span key={pi} className="speech-phrase">
                    {p.words.map((w, wi) => (
                      <span
                        key={wi}
                        className={`speech-word src-${w.pronSource}${w.emphasis ? ' emph' : ''}`}
                        title={`${SOURCE_LABEL[w.pronSource]}${w.alternatives.length > 1 ? `; ${w.alternatives.length} pronunciations: ${w.alternatives.map(formatPronunciation).join(' · ')}` : ''}`}
                      >
                        <span className="w-text">{w.text}</span>
                        <span className="w-ipa">/{formatPronunciation(w.phones)}/</span>
                      </span>
                    ))}
                    <span className="speech-boundary">{p.boundary === 'comma' ? '|' : p.boundary === 'clause' ? '‖' : '⏎'}</span>
                  </span>
                ))}
              </div>
            ))}
            <p className="speech-legend">
              Hover a word for its source and alternatives. Underlined words were not in a dictionary (guessed
              by rules).
            </p>
          </section>
        </>
      )}

      <footer>
        {stats
          ? `Lexicon: Britfone ${stats.britfone.toLocaleString()} words (MIT), CMUdict ${stats.cmudict.toLocaleString()} words converted to British (BSD), ${stats.custom} project words. `
          : 'Loading Britfone and CMUdict… '}
        <a href="/licenses/speech-data.txt">Licences</a>
      </footer>
    </div>
  )
}
