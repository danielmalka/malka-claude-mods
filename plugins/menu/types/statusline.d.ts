// Vendored from the `statusline` mod's contract (apiVersion 1): only the entry the menu reads. Absent (undefined) when that mod is not installed.
declare module 'claude-code' {
  interface PluginState {
    statusline: {
      menuEntry: { apiVersion: number; title: string; summary: string; order: number }
    }
  }
}
export {}
