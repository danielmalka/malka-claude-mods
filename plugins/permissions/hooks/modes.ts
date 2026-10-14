export const MODES = ['default', 'plan', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions'] as const

export type Mode = (typeof MODES)[number]

export const isMode = (v: unknown): v is Mode => MODES.includes(v as Mode)

export const MODE_LABELS: Record<Mode, string> = {
  default: 'ask',
  plan: 'plan',
  acceptEdits: 'accept edits',
  auto: 'auto',
  dontAsk: "don't ask",
  bypassPermissions: 'bypass permissions',
}

// A value in settings.json that is not one of the modes stays as written.
export const modeLabel = (m: string): string => (isMode(m) ? MODE_LABELS[m] : m)
