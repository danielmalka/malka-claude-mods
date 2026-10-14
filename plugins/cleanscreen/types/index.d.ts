export type StepStatus = 'pending' | 'in_progress' | 'completed'
export type CleanStep = { id: string; text: string; status: StepStatus }
export type CleanTask = { title: string; startedAt: number; doneAt: number | null; steps: CleanStep[] }
export type CleanTheme = 'blue' | 'dark' | 'light' | 'green' | 'rainbow' | 'custom'
export type CleanColors = { bar: string; text: string; border: string }

// Menu contract, apiVersion 1: an optional `menu` mod lists this entry.
export type MenuEntry = { apiVersion: 1; title: string; summary: string; order: number }

declare module 'claude-code' {
  interface PluginState {
    cleanscreen: {
      menuEntry: MenuEntry
      isOn: boolean
      theme: CleanTheme
      custom: CleanColors
      isCollapsed: boolean
      task: CleanTask | null
      clock: number
    }
  }
}
