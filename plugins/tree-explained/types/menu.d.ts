// Vendored from the optional `menu` mod's contract (apiVersion 1). Absent (undefined) when that mod is not installed.
declare module 'claude-code' {
  interface PluginState {
    menu: { panel: string; present: boolean }
  }
}
export {}
