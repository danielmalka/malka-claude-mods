import type { Effort, Model } from '../types'
import type { Config } from './config'
import type { IO } from './io'
import { EFFORTS, MODELS, QUESTIONS } from './questions'

export const EXCERPT_CHARS = 5000
export const TIMEOUT_MS = 3000

export type Decision = { model: Model; modelConfidence: number; effort: Effort; effortConfidence: number }
export type Result = ({ ok: true } & Decision) | { ok: false; reason: string }

const clamp = (n: number) => Math.min(1, Math.max(0, n))
// Probabilities in the given key order: every value finite and >= 0, sum > 0; normalized by the sum.
const probs = (p: unknown, keys: string[]): number[] | undefined => {
  if (typeof p !== 'object' || p === null) return undefined
  const v = keys.map(k => (p as Record<string, unknown>)[k])
  if (!v.every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0)) return undefined
  const sum = (v as number[]).reduce((s, x) => s + x, 0)
  return sum > 0 && Number.isFinite(sum) ? (v as number[]).map(x => x / sum) : undefined
}

// R9: Choice confidence from the peak probability over N options.
function choiceConfidence(p: number[]) {
  return clamp((p.length * Math.max(...p) - 1) / (p.length - 1))
}
// R9: Score confidence from the probability-weighted distance to the peak level.
function scoreConfidence(p: number[]) {
  const m = p.indexOf(Math.max(...p))
  const spread = p.reduce((s, v, i) => s + v * Math.abs(i - m), 0)
  const even = p.reduce((s, _, i) => s + Math.abs(i - (p.length - 1) / 2), 0) / p.length
  return clamp(1 - spread / even)
}

export function parse(body: unknown): Result {
  const a = (body as any)?.answers
  const m = a?.model
  const e = a?.effort
  const names = Object.keys(MODELS) as Model[]
  const mp = probs(m?.probabilities, names)
  const ep = probs(e?.probabilities, EFFORTS.map((_, i) => String(i)))
  if (m?.type !== 'choice' || e?.type !== 'score' || !mp || !ep) return { ok: false, reason: 'malformed answer' }
  const model = names.includes(m.choice) ? (m.choice as Model) : names[mp.indexOf(Math.max(...mp))]
  const effort = EFFORTS[ep.indexOf(Math.max(...ep))]
  const own = (c: unknown) => (typeof c === 'number' && Number.isFinite(c) ? clamp(c) : undefined)
  return { ok: true, model, modelConfidence: own(m.confidence) ?? choiceConfidence(mp), effort, effortConfidence: own(e.confidence) ?? scoreConfidence(ep) }
}

// One POST, no retry (R20). Every failure becomes { ok: false, reason }; nothing throws.
export async function decide(io: Pick<IO, 'fetch' | 'after'>, cfg: Config, text: string): Promise<Result> {
  if (cfg.key === '') return { ok: false, reason: 'no key' }
  try {
    const request = (async (): Promise<Result> => {
      const r = await io.fetch(`${cfg.url}/v1/systemone`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model, state: { prompt: text.slice(0, EXCERPT_CHARS) }, questions: QUESTIONS }),
      })
      if (r.status < 200 || r.status > 299) return { ok: false, reason: `HTTP ${r.status}` }
      return parse(JSON.parse(r.text))
    })().catch((): Result => ({ ok: false, reason: 'request failed' }))
    // $.http.fetch has no timeout/abort: race a timer; a late response is ignored (R21).
    let timer: { cancel(): void } | undefined
    const timeout = new Promise<Result>(res => {
      timer = io.after(TIMEOUT_MS, () => res({ ok: false, reason: 'timeout' }))
    })
    try {
      return await Promise.race([request, timeout])
    } finally {
      timer?.cancel()
    }
  } catch {
    return { ok: false, reason: 'request failed' }
  }
}
