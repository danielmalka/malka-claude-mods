export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// Menu contract, apiVersion 1: an optional `menu` mod lists this entry.
export type MenuEntry = { apiVersion: 1; title: string; summary: string; order: number }

declare module 'claude-code' {
  interface PluginState {
    mode: {
      menuEntry: MenuEntry
      // true once the user picked a model or an effort in this session (read by other mods, e.g. a router)
      manual: boolean
      // the effort the user chose; null = none, no override is sent
      effort: Effort | null
      // the effort the session itself runs at, as last seen
      sessionEffort: Effort | null
      // the session's model id, e.g. claude-opus-5-5
      sessionModel: string | null
    }
  }
}
