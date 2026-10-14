export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Model = 'haiku' | 'sonnet' | 'opus'

declare module 'claude-code' {
  interface PluginState {
    'decision-router': {
      // the effort the router imposes on every main-loop request while its override holds; null = none (read by `mode`)
      effort: Effort | null
    }
  }
}
