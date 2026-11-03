import { lazy, Suspense, useState } from 'react'
import { App } from './App'

// The speech panel (and its dictionaries) load only when the Speech tab is first opened
const SpeechPanel = lazy(() => import('./SpeechPanel').then((m) => ({ default: m.SpeechPanel })))

type Tab = 'music' | 'speech'
const TAB_KEY = 'continuous:tab'

function initialTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'speech' ? 'speech' : 'music'
  } catch {
    return 'music'
  }
}

/** Music and Speech side by side; the music app stays mounted so playback continues. */
export function Shell() {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [speechOpened, setSpeechOpened] = useState(tab === 'speech')
  const choose = (t: Tab) => {
    setTab(t)
    if (t === 'speech') setSpeechOpened(true)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      // storage disabled: the tab just isn't remembered
    }
  }
  return (
    <>
      <nav className="tabs" aria-label="Mode">
        <button className={tab === 'music' ? 'active' : ''} onClick={() => choose('music')}>
          Music
        </button>
        <button className={tab === 'speech' ? 'active' : ''} onClick={() => choose('speech')}>
          Speech
        </button>
      </nav>
      <div hidden={tab !== 'music'}>
        <App />
      </div>
      {speechOpened && (
        <div hidden={tab !== 'speech'}>
          <Suspense fallback={<div className="app">Loading speech…</div>}>
            <SpeechPanel />
          </Suspense>
        </div>
      )}
    </>
  )
}
