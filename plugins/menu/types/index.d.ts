// Menu contract, apiVersion 1.
export type Panel = string
declare module 'claude-code' {
  interface PluginState {
    menu: {
      // 'main' or the name of the member whose page the pane shows
      panel: Panel
      // true while this mod is loaded (set at session.start)
      present: boolean
    }
  }
}
