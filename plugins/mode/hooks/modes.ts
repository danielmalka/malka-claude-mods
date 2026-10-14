import type { Effort } from '../types'

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// The models the pane offers, by the alias `/model` takes.
export const MODELS = [
  { alias: 'fable', label: 'Fable' },
  { alias: 'opus', label: 'Opus' },
  { alias: 'sonnet', label: 'Sonnet' },
  { alias: 'haiku', label: 'Haiku' },
] as const

// `claude-opus-5-5` -> `opus`; null for an id that is not a Claude model's.
export const modelFamily = (id: string | null): string | null => id?.match(/^claude-([a-z]+)-/i)?.[1]?.toLowerCase() ?? null

// `claude-opus-5-5` as `Opus 5.5`; a name that is not a Claude model id stays as it is.
export function prettyModel(id: string): string {
  const match = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/i)
  if (match === null) return id
  const [, family = '', major = '', minor] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor === undefined ? '' : `.${minor}`}`
}

export const isEffort = (v: unknown): v is Effort => typeof v === 'string' && EFFORTS.includes(v as Effort)

export const summary = (model: string | null, level: Effort | null) => `${model === null ? '' : `${prettyModel(model)} · `}effort ${level ?? 'default'}`
