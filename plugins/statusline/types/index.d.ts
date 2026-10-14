export type StatusRateLimit = { label: string; percent: number; resetsAt: number | null }

export type StatusSnapshot = {
  model: string
  dir: string
  branch: string
  ctxPercent: number | null
  ctxTokens: number | null
  ctxWindow: number | null
  limits: StatusRateLimit[]
}

// Menu contract, apiVersion 1: an optional `menu` mod lists this entry.
export type MenuEntry = { apiVersion: 1; title: string; summary: string; order: number }

declare module 'claude-code' {
  interface PluginState {
    statusline: {
      menuEntry: MenuEntry
      isOn: boolean
      snapshot: StatusSnapshot | null
      lastResponseAt: number | null
      clock: number
    }
  }
}
