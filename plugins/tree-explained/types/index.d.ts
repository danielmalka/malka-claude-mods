// Menu contract, apiVersion 1: an optional `menu` mod lists this entry.
export type MenuEntry = { apiVersion: 1; title: string; summary: string; order: number }

// One file the session touched: 'edit' covers Edit and Write, 'read' a file only read.
export type Entry = { path: string; kind: 'read' | 'edit'; add: number; del: number; seq: number; outside?: true }

// One finished turn's summary; isFallback is true when the model did not answer.
export type Summary = { turn: number; text: string; isFallback: boolean }

declare module 'claude-code' {
  interface PluginState {
    'tree-explained': {
      menuEntry: MenuEntry
      isOn: boolean
      // touched files by session-relative path
      files: Record<string, Entry>
      // paths of the file calls in flight now
      inflight: string[]
      // flips every 500 ms while a file call is in flight
      shimmer: boolean
      summaries: Summary[]
      // the language override, null = follow the first prompt
      lang: string | null
      // keys of the folders showing their children (the outside row is '(outside project)')
      open: string[]
      // section and read-only filter flags, remembered between sessions
      treeHidden: boolean
      summaryHidden: boolean
      readsHidden: boolean
      // true once the person scrolled the pane by hand: the tree stops following the latest edit
      manual: boolean
    }
  }
}
