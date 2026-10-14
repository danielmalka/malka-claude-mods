import type { IO } from './io'

export const SUBAGENT_MODES = ['ask', 'auto', 'off'] as const
export type Config = {
  key: string
  url: string
  model: string
  minConfidence: number
  subagents: (typeof SUBAGENT_MODES)[number]
  invalid: string[] // names of optional variables whose value was rejected (R2)
}

export async function loadConfig(io: Pick<IO, 'env'>): Promise<Config> {
  const get = async (name: string) => {
    // a failing env read counts as unset, so the worst case is an idle mod (no key)
    let v: string | undefined
    try {
      v = (await io.env(name))?.trim()
    } catch {}
    return v === '' ? undefined : v
  }
  const invalid: string[] = []
  const rawMin = await get('DECISION_MOD_MIN_CONFIDENCE')
  let minConfidence = 0.6
  if (rawMin !== undefined) {
    const n = Number(rawMin)
    if (Number.isFinite(n) && n >= 0 && n <= 1) minConfidence = n
    else invalid.push('DECISION_MOD_MIN_CONFIDENCE')
  }
  const rawSub = await get('DECISION_MOD_SUBAGENTS')
  let subagents: Config['subagents'] = 'ask'
  if (rawSub !== undefined) {
    if ((SUBAGENT_MODES as readonly string[]).includes(rawSub)) subagents = rawSub as Config['subagents']
    else invalid.push('DECISION_MOD_SUBAGENTS')
  }
  // R2: https only; plain http just for the local machine
  const DEFAULT_URL = 'https://openrouter.ai/api'
  let url = DEFAULT_URL
  const rawUrl = await get('DECISION_MOD_URL')
  if (rawUrl !== undefined) {
    const clean = normalizedUrl(rawUrl)
    if (clean !== undefined) url = clean
    else invalid.push('DECISION_MOD_URL')
  }
  return {
    key: (await get('DECISION_MOD_KEY')) ?? '',
    url: url.replace(/\/+$/, ''),
    model: (await get('DECISION_MOD_MODEL')) ?? 'typesafe/jev-1.13',
    minConfidence,
    subagents,
    invalid,
  }
}

// R2: https, or http for the local machine only; no userinfo, query or fragment.
// Returns the parser's own normalized form, so the string validated is the string fetched.
function normalizedUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw)
    if (u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '' || /[?#@]/.test(raw)) return undefined
    const ok = u.protocol === 'https:' ? u.hostname !== '' : u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    return ok ? (u.origin + u.pathname).replace(/\/+$/, '') : undefined
  } catch {
    return undefined
  }
}
