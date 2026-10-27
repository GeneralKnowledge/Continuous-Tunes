declare module '@strudel/web' {
  export function initStrudel(options?: {
    prebake?: () => void | Promise<void>
    miniAllStrings?: boolean
  }): Promise<StrudelRepl>

  export interface StrudelRepl {
    scheduler: {
      /** Current playback position in cycles. */
      now(): number
    }
  }

  export function hush(): void

  /** Resume the audio context and load the AudioWorklet synths (supersaw, crush, …). */
  export function initAudio(options?: { disableWorklets?: boolean }): Promise<void>

  export function evaluate(code: string, autoplay?: boolean): Promise<unknown>

  export function samples(
    url: string | Record<string, unknown>,
    baseUrl?: string,
  ): void | Promise<void>
}
