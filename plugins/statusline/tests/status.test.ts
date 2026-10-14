import { expect, test } from 'claude-code/testing'

import { backgroundPill, barFill, cacheState, CACHE_TTL_MS, colorFor, fmtDuration, fmtTokens, prettyModel, statsWidth } from '../hooks/status'
import { configDir, moveStatusLine } from '../hooks/settings'

test('fmtTokens, fmtDuration and barFill', () => {
  expect([fmtTokens(999), fmtTokens(12_400), fmtTokens(1_000_000), fmtTokens(1_500_000)]).toEqual(['999', '12k', '1M', '1.5M'])
  expect([fmtDuration(45_000), fmtDuration(12 * 60_000), fmtDuration(278 * 60_000), fmtDuration(138 * 3_600_000)]).toEqual(['45s', '12m', '4h38m', '5d18h'])
  expect([barFill(-5), barFill(0), barFill(55), barFill(100), barFill(250)]).toEqual([0, 0, 5, 10, 10])
})

test('colors, cache state, model name', () => {
  expect([colorFor(10), colorFor(70), colorFor(90)]).toEqual(['#22c55e', '#eab308', '#ef4444'])
  expect([cacheState(null, 5), cacheState(0, CACHE_TTL_MS - 1), cacheState(0, CACHE_TTL_MS)]).toEqual([null, 'ok', 'over'])
  expect([prettyModel('claude-opus-5-5'), prettyModel('claude-sonnet-5'), prettyModel('gpt-x')]).toEqual(['Opus 5.5', 'Sonnet 5', 'gpt-x'])
})

test('background pill reads only running shells and monitors', () => {
  expect(backgroundPill('esc to interrupt · 2 shells, 1 monitor')).toBe('2 shells, 1 monitor')
  expect(backgroundPill('3 background tasks')).toBe('3 background tasks')
  expect(backgroundPill('ran 2 shell commands')).toBeNull()
})

test('statsWidth shrinks with the detail level', () => {
  const limits = [{ label: '5h', percentText: '42%', resetText: ' (resets 1h00m)' }]
  const [d0, d1, d2] = ([0, 1, 2] as const).map(d => statsWidth('10% 20k', limits, '● cache ok', d))
  expect(d0! > d1!).toBe(true)
  expect(d1! > d2!).toBe(true)
  expect(d2).toBe(4 + 7 + (5 + 2 + 1 + 3) + (5 + 10))
})

test('moveStatusLine keeps the user value and puts it back', () => {
  const cmd = { type: 'command', command: 'echo hi' }
  const on = moveStatusLine({ a: 1, statusLine: cmd }, true, undefined)
  expect(on).toEqual({ next: { a: 1 }, save: { statusLine: cmd }, prev: undefined, drop: false })
  expect(moveStatusLine({ a: 1 }, true, undefined)).toBeUndefined()
  expect(moveStatusLine({ a: 1 }, false, { statusLine: cmd })).toEqual({ next: { a: 1, statusLine: cmd }, save: undefined, prev: undefined, drop: true })
  // the user set a new one meanwhile: it is not overwritten
  const kept = moveStatusLine({ statusLine: 'new' }, false, { statusLine: cmd })
  expect(kept).toMatchObject({ prev: cmd, drop: true })
  expect(kept!.next).toEqual({ statusLine: 'new' })
})

test('configDir accepts only absolute paths', () => {
  expect(configDir('/cfg/', '/h')).toBe('/cfg')
  expect(configDir('rel', '/h')).toBe('/h/.claude')
  expect(() => configDir(undefined, undefined)).toThrow()
})
