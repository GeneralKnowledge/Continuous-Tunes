import { Component, type ErrorInfo, type ReactNode } from 'react'
import { LocalStorageBackend, clearAll } from '../persistence/session'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Last-resort fallback so a crash shows a message and a way out instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('App crashed', error, info.componentStack)
  }

  private resetSavedData = () => {
    clearAll(new LocalStorageBackend())
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="app">
        <h1>Something went wrong</h1>
        <p>{this.state.error.message}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
        <button type="button" onClick={this.resetSavedData}>
          Clear saved data and reload
        </button>
      </div>
    )
  }
}
