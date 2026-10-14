export type ResumeCrash = {
  cwd: string
  sessionId: string
  at: number // last activity seen before the interruption (ms)
  lastPrompt: string
  branch?: string
  dirty: string[] // up to 10 lines of `git status --porcelain`
  dirtyCount: number
}

declare module 'claude-code' {
  interface PluginState {
    resume: { crash: ResumeCrash | null }
  }
}
