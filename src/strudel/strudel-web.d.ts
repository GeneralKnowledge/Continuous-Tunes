declare module '@strudel/web' {
  export function initStrudel(options?: {
    prebake?: () => void | Promise<void>
    miniAllStrings?: boolean
  }): Promise<unknown>

  export function hush(): void

  export function evaluate(code: string, autoplay?: boolean): Promise<unknown>

  export function samples(
    url: string | Record<string, unknown>,
    baseUrl?: string,
  ): void | Promise<void>
}
