import type { EngineInterface } from 'claude-code'

// The only seam to the engine used by config/decide, so both stay pure and testable.
export type IO = {
  env: (name: string) => Promise<string | undefined>
  fetch: (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{ status: number; text: string }>
  after: (ms: number, cb: () => void) => { cancel(): void }
}

// Engine adapter for the hook slices; exercised there (a test hook cannot call $.env/$.http itself).
export function fromEngine($: EngineInterface): IO {
  // $.env.get takes literal names only (the engine lists a module's variables), so one thunk per name
  const vars: Record<string, () => Promise<string | undefined>> = {
    DECISION_MOD_URL: () => $.env.get('DECISION_MOD_URL'),
    DECISION_MOD_KEY: () => $.env.get('DECISION_MOD_KEY'),
    DECISION_MOD_MODEL: () => $.env.get('DECISION_MOD_MODEL'),
    DECISION_MOD_MIN_CONFIDENCE: () => $.env.get('DECISION_MOD_MIN_CONFIDENCE'),
    DECISION_MOD_SUBAGENTS: () => $.env.get('DECISION_MOD_SUBAGENTS'),
  }
  return {
    env: async name => vars[name]?.(),
    fetch: (url, init) => $.http.fetch(url, init),
    after: (ms, cb) => $.clock.after(ms, cb),
  }
}
