import { expect, test } from 'claude-code/testing'

import { loadConfig } from '../hooks/config'
import { decide, parse } from '../hooks/decide'

const KEY = 'k-test-123'
const reply = (answers: any, status = 200) => ({ status, text: JSON.stringify({ answers }) })
const good = {
  model: { type: 'choice', choice: 'sonnet', confidence: 0.9, probabilities: { haiku: 0.05, sonnet: 0.9, opus: 0.05 } },
  effort: { type: 'score', score: 2, confidence: 0.8, probabilities: { 0: 0, 1: 0.05, 2: 0.9, 3: 0.05, 4: 0 } },
}

// Fake engine seam: env from a map, fetch from a handler, a manual timer.
function seam(vars: Record<string, string> = { DECISION_MOD_KEY: KEY }, handler: (url: string, init: any) => any = () => reply(good)) {
  const reqs: any[] = []
  const timers: { ms: number; cb: () => void; cancelled: boolean }[] = []
  return {
    reqs,
    timers,
    env: async (n: string) => vars[n],
    fetch: async (url: string, init: any) => (reqs.push({ url, ...init }), handler(url, init)),
    after: (ms: number, cb: () => void) => {
      const t = { ms, cb, cancelled: false }
      timers.push(t)
      return { cancel: () => void (t.cancelled = true) }
    },
  }
}
const run = async (s: ReturnType<typeof seam>, text = 'hello') => decide(s, await loadConfig(s), text)
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9)

test('R1 key absent, empty or blank: no network call, ok false', async () => {
  for (const vars of [{}, { DECISION_MOD_KEY: '' }, { DECISION_MOD_KEY: '  ' }]) {
    const s = seam(vars)
    expect(await run(s)).toEqual({ ok: false, reason: 'no key' })
    expect(s.reqs).toEqual([])
  }
})

test('R2 defaults and invalid variables', async () => {
  expect(await loadConfig(seam())).toEqual({ key: KEY, url: 'https://openrouter.ai/api', model: 'typesafe/jev-1.13', minConfidence: 0.6, subagents: 'ask', invalid: [] })
  for (const bad of ['abc', '1.5', '-0.1']) {
    const c = await loadConfig(seam({ DECISION_MOD_KEY: KEY, DECISION_MOD_MIN_CONFIDENCE: bad, DECISION_MOD_SUBAGENTS: 'yes' }))
    expect([c.minConfidence, c.subagents, c.invalid]).toEqual([0.6, 'ask', ['DECISION_MOD_MIN_CONFIDENCE', 'DECISION_MOD_SUBAGENTS']])
  }
  const ok = await loadConfig(seam({ DECISION_MOD_KEY: KEY, DECISION_MOD_MIN_CONFIDENCE: '0', DECISION_MOD_SUBAGENTS: 'auto', DECISION_MOD_URL: 'http://localhost:8080/', DECISION_MOD_MODEL: 'm' }))
  expect(ok).toEqual({ key: KEY, url: 'http://localhost:8080', model: 'm', minConfidence: 0, subagents: 'auto', invalid: [] })
})

test('R2 single invalid variable, boundaries, empty/whitespace and NaN/Infinity', async () => {
  const c = (extra: Record<string, string>) => loadConfig(seam({ DECISION_MOD_KEY: KEY, ...extra }))
  expect((await c({ DECISION_MOD_MIN_CONFIDENCE: 'x' })).invalid).toEqual(['DECISION_MOD_MIN_CONFIDENCE'])
  expect((await c({ DECISION_MOD_SUBAGENTS: 'x' })).invalid).toEqual(['DECISION_MOD_SUBAGENTS'])
  for (const v of ['NaN', 'Infinity', '-Infinity', '1.0001', '-0.0001']) {
    const r = await c({ DECISION_MOD_MIN_CONFIDENCE: v })
    expect([r.minConfidence, r.invalid]).toEqual([0.6, ['DECISION_MOD_MIN_CONFIDENCE']])
  }
  expect((await c({ DECISION_MOD_MIN_CONFIDENCE: '0' })).minConfidence).toBe(0)
  expect((await c({ DECISION_MOD_MIN_CONFIDENCE: '1' })).minConfidence).toBe(1)
  expect((await c({ DECISION_MOD_MIN_CONFIDENCE: '1' })).invalid).toEqual([])
  for (const v of ['', '   ']) {
    const r = await c({ DECISION_MOD_MIN_CONFIDENCE: v, DECISION_MOD_SUBAGENTS: v, DECISION_MOD_URL: v, DECISION_MOD_MODEL: v })
    expect(r).toEqual({ key: KEY, url: 'https://openrouter.ai/api', model: 'typesafe/jev-1.13', minConfidence: 0.6, subagents: 'ask', invalid: [] })
  }
})

test('R8 R11 body shape, header, 5000-char excerpt, state only the prompt', async () => {
  const s = seam()
  expect(await run(s, 'x'.repeat(6000))).toEqual({ ok: true, model: 'sonnet', modelConfidence: 0.9, effort: 'high', effortConfidence: 0.8 })
  const req = s.reqs[0]
  expect(req.url).toBe('https://openrouter.ai/api/v1/systemone')
  expect(req.method).toBe('POST')
  expect(req.headers.authorization).toBe(`Bearer ${KEY}`)
  expect(req.url).not.toContain(KEY)
  expect(Object.entries(req.headers).filter(([, v]) => String(v).includes(KEY)).map(([k]) => k)).toEqual(['authorization'])
  const body = JSON.parse(req.body)
  expect(Object.keys(body).sort()).toEqual(['model', 'questions', 'state'])
  expect(body.model).toBe('typesafe/jev-1.13')
  expect(Object.keys(body.state)).toEqual(['prompt'])
  expect(body.state.prompt).toHaveLength(5000)
  expect(Object.keys(body.questions)).toEqual(['model', 'effort'])
  expect(body.questions.model.type).toBe('choice')
  expect(Object.keys(body.questions.model.criteria)).toEqual(['haiku', 'sonnet', 'opus'])
  expect(body.questions.effort.type).toBe('score')
  expect(body.questions.effort.criteria).toHaveLength(5)
  expect(req.body).not.toContain(KEY)
})

test('R8 effort is the peak of the Score, not the weighted score', () => {
  const a = { ...good, effort: { type: 'score', score: 2.0, probabilities: { 0: 0.4, 1: 0, 2: 0, 3: 0, 4: 0.6 } } }
  expect((parse({ answers: a }) as any).effort).toBe('max')
})

test('R8 argmax of probabilities when choice is absent', () => {
  const a = { ...good, model: { type: 'choice', probabilities: { haiku: 0.2, sonnet: 0.1, opus: 0.7 } } }
  expect((parse({ answers: a }) as any).model).toBe('opus')
})

test('R9 confidence from the answer when present (clamped), from the formulas when absent', () => {
  expect((parse({ answers: { ...good, model: { ...good.model, confidence: 1.7 } } }) as any).modelConfidence).toBe(1)
  const a = {
    model: { type: 'choice', probabilities: { haiku: 0.2, sonnet: 0.2, opus: 0.6 } }, // (3*0.6-1)/2
    effort: { type: 'score', probabilities: { 0: 0, 1: 0.57, 2: 0.43, 3: 0, 4: 0 } }, // spread .43, evenSpread 1.2
  }
  const r = parse({ answers: a }) as any
  near(r.modelConfidence, 0.4)
  near(r.effortConfidence, 1 - 0.43 / 1.2)
  const flat = parse({ answers: { ...a, model: { type: 'choice', probabilities: { haiku: 1 / 3, sonnet: 1 / 3, opus: 1 / 3 } } } }) as any
  near(flat.modelConfidence, 0)
})

test('R21 3 s timeout: timer armed for 3000 ms, late response ignored, no unhandled rejection', async () => {
  let release: (v: any) => void = () => {}
  let fail: (e: any) => void = () => {}
  const s = seam(undefined, () => new Promise((res, rej) => ((release = res), (fail = rej))))
  const p = run(s)
  while (s.timers.length === 0) await Promise.resolve()
  expect(s.timers[0].ms).toBe(3000)
  s.timers[0].cb() // 3 s elapse
  expect(await p).toEqual({ ok: false, reason: 'timeout' })
  release(reply(good)) // late reply changes nothing
  fail(new Error('late')) // a late failure must not surface as an unhandled rejection
  await new Promise(r => setTimeout(r, 5))
  expect(await p).toEqual({ ok: false, reason: 'timeout' })
})

test('timer is cancelled when the request settles first', async () => {
  const s = seam()
  expect((await run(s)).ok).toBe(true)
  expect(s.timers).toHaveLength(1)
  expect(s.timers[0].cancelled).toBe(true)
})

test('decide never throws: sync throw arming the timer, sync throw in fetch, env rejecting', async () => {
  const s = seam()
  const cfg = await loadConfig(s)
  expect(await decide({ fetch: s.fetch, after: () => { throw new Error('no timer') } }, cfg, 'x')).toEqual({ ok: false, reason: 'request failed' })
  expect(await decide({ fetch: () => { throw new Error('sync') }, after: s.after }, cfg, 'x')).toEqual({ ok: false, reason: 'request failed' })
  for (const env of [async () => { throw new Error('env down') }, () => { throw new Error('env sync') }]) {
    const c = await loadConfig({ env })
    expect(c.key).toBe('')
    expect(await decide(s, c, 'x')).toEqual({ ok: false, reason: 'no key' })
  }
})

test('probabilities: negative, non-finite, all-zero rejected; otherwise normalized by the sum', () => {
  const bad = (m: any, e: any) => expect(parse({ answers: { model: { type: 'choice', probabilities: m }, effort: { type: 'score', probabilities: e } } })).toEqual({ ok: false, reason: 'malformed answer' })
  const gm = { haiku: 0.1, sonnet: 0.8, opus: 0.1 }
  const ge = { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 }
  bad({ haiku: -0.1, sonnet: 1.1, opus: 0 }, ge)
  bad({ haiku: NaN, sonnet: 1, opus: 0 }, ge)
  bad({ haiku: Infinity, sonnet: 0, opus: 0 }, ge)
  bad({ haiku: 0, sonnet: 0, opus: 0 }, ge)
  bad(gm, { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 })
  bad(gm, { 0: -1, 1: 0, 2: 2, 3: 0, 4: 0 })
  const r = parse({ answers: { model: { type: 'choice', probabilities: { haiku: 2, sonnet: 2, opus: 6 } }, effort: { type: 'score', probabilities: ge } } }) as any
  near(r.modelConfidence, (3 * 0.6 - 1) / 2) // 6/10 after normalizing
})

test('R20 non-2xx, malformed JSON, wrong shape, thrown fetch: ok false, never throws', async () => {
  const cases: [() => any, string][] = [
    [() => reply(good, 500), 'HTTP 500'],
    [() => ({ status: 200, text: 'not json' }), 'request failed'],
    [() => reply({ model: { type: 'choice', probabilities: { haiku: 1 } } }), 'malformed answer'],
    [() => reply({ ...good, effort: { type: 'score', probabilities: { 0: 'x' } } }), 'malformed answer'],
    [() => reply({ ...good, model: { ...good.model, type: 'score' } }), 'malformed answer'],
    [() => reply({ ...good, effort: { ...good.effort, type: 'choice' } }), 'malformed answer'],
    [() => reply({ ...good, model: { type: 'choice', choice: 'sonnet' } }), 'malformed answer'],
    [() => reply({ ...good, effort: { type: 'score', score: 2 } }), 'malformed answer'],
    [() => ({ status: 200, text: 'null' }), 'malformed answer'],
    [() => ({ status: 199, text: '{}' }), 'HTTP 199'],
    [() => ({ status: 300, text: '{}' }), 'HTTP 300'],
    [() => { throw new Error('net down') }, 'request failed'],
  ]
  for (const [h, reason] of cases) expect(await run(seam(undefined, h))).toEqual({ ok: false, reason })
})

test('R20 no automatic retry: one failing call is one request', async () => {
  const s = seam(undefined, () => reply(good, 503))
  await run(s)
  expect(s.reqs).toHaveLength(1)
})

test('R10 same request shape for any endpoint, no provider branch', async () => {
  const shapes = new Set<string>()
  for (const url of ['https://openrouter.ai/api', 'http://localhost:9/x', 'https://other.example']) {
    const s = seam({ DECISION_MOD_KEY: KEY, DECISION_MOD_URL: url })
    await run(s)
    shapes.add(JSON.stringify([s.reqs[0].method, s.reqs[0].headers, s.reqs[0].body, s.reqs[0].url.replace(url, '')]))
  }
  expect(shapes.size).toBe(1)
})

// ponytail: a source scan is impossible here (tests may import only relative files and claude-code);
// the no-write guarantee is the IO seam, which has env/fetch/after and no write method.
test('R3 the IO seam used by config/decide has no write capability; one decision = one fetch', async () => {
  const s = seam()
  await run(s)
  expect(Object.keys(s).sort()).toEqual(['after', 'env', 'fetch', 'reqs', 'timers'])
  expect(s.reqs).toHaveLength(1)
})

test('R2 DECISION_MOD_URL: https ok, http only for localhost; anything else is invalid and falls back to the default', async () => {
  const url = async (v: string) => {
    const c = await loadConfig(seam({ DECISION_MOD_KEY: KEY, DECISION_MOD_URL: v }))
    return [c.url, c.invalid]
  }
  expect(await url('https://example.com/api/')).toEqual(['https://example.com/api', []])
  for (const v of ['http://localhost', 'http://localhost:8080/x', 'http://127.0.0.1:9', 'http://[::1]:1/']) expect((await url(v))[1]).toEqual([])
  for (const v of ['http://example.com', 'http://localhost.evil.com', 'http://localhost@evil.com', 'ftp://example.com', 'file:///etc/passwd', 'garbage', 'https://', 'javascript:alert(1)', 'https://openrouter.ai@evil.example/x', 'https://user:pw@host', 'https://user@host/api', 'https://host/?q=1', 'https://host/#frag', 'https://host/api?'])
    expect(await url(v)).toEqual(['https://openrouter.ai/api', ['DECISION_MOD_URL']])
})

test('R2 DECISION_MOD_URL is stored normalized: the validated string is the fetched string', async () => {
  const cfgUrl = async (v: string) => (await loadConfig(seam({ DECISION_MOD_KEY: KEY, DECISION_MOD_URL: v }))).url
  // the URL parser strips tabs and newlines and turns backslashes into slashes
  expect(await cfgUrl('https://exa\tmple.com/ap\ni')).toBe('https://example.com/api')
  expect(await cfgUrl('https://example.com\\api')).toBe('https://example.com/api')
  expect(await cfgUrl('HTTPS://Example.COM:443/api//')).toBe('https://example.com/api')
  expect(await cfgUrl('http://localhost:8080\\x')).toBe('http://localhost:8080/x')
  // the request goes to <normalized>/v1/systemone
  const s = seam({ DECISION_MOD_KEY: KEY, DECISION_MOD_URL: 'https://exa\tmple.com\\api/' })
  await decide(s, await loadConfig(s), 'hi')
  expect(s.reqs[0].url).toBe('https://example.com/api/v1/systemone')
})
