// Menu contract, apiVersion 1: an optional `menu` mod lists this entry.
export type MenuEntry = { apiVersion: 1; title: string; summary: string; order: number }

declare module 'claude-code' {
  interface PluginState {
    permissions: {
      menuEntry: MenuEntry
      // permissions.defaultMode of the user's settings.json: the mode new sessions start in
      defaultMode: string
    }
  }
}
