import { expect, test } from 'claude-code/testing'

import { cacheState, CACHE_TTL_MS, colorFor, fmtDuration, fmtTokens, layoutRows, pickLayout, prettyModel, rowCount, segmentTexts, SEP_WIDTH } from '../hooks/status'
import { configDir, moveStatusLine } from '../hooks/settings'

test('fmtTokens and fmtDuration', () => {
  expect([fmtTokens(999), fmtTokens(12_400), fmtTokens(1_000_000), fmtTokens(1_500_000)]).toEqual(['999', '12k', '1M', '1.5M'])
  expect([fmtDuration(45_000), fmtDuration(12 * 60_000), fmtDuration(278 * 60_000), fmtDuration(138 * 3_600_000)]).toEqual(['45s', '12m', '4h38m', '5d18h'])
})

test('colors, cache state, model name', () => {
  expect([colorFor(10), colorFor(70), colorFor(90)]).toEqual(['#22c55e', '#eab308', '#ef4444'])
  expect([cacheState(null, 5), cacheState(0, CACHE_TTL_MS - 1), cacheState(0, CACHE_TTL_MS)]).toEqual([null, 'ok', 'over'])
  expect([prettyModel('claude-opus-5-5'), prettyModel('claude-sonnet-5'), prettyModel('gpt-x')]).toEqual(['Opus 5.5', 'Sonnet 5', 'gpt-x'])
})

const parts = {
  ctxText: '41% 82k/200k',
  limits: [
    { label: '5h', percentText: '30%', resetText: ' (resets 1h00m)' },
    { label: '7d', percentText: '12%', resetText: ' (resets 5d18h)' },
  ],
  cacheText: '● cache ok',
  head: 'Opus 5.5 · proj · main',
}

test('segmentTexts: priority order, text only, no cache segment when empty', () => {
  const all = segmentTexts(parts)
  expect(all.map(s => s.key)).toEqual(['ctx', 'limit-5h', 'limit-7d', 'cache', 'head'])
  expect(all[0]!.text).toBe('ctx 41% 82k/200k')
  expect(all[1]!.text).toBe('5h 30% (resets 1h00m)')
  expect(segmentTexts({ ...parts, cacheText: '' }).map(s => s.key)).toEqual(['ctx', 'limit-5h', 'limit-7d', 'head'])
})

test('layoutRows: empty, one row, wrap, oversized alone, every index once', () => {
  expect(layoutRows([], 80, SEP_WIDTH, 0)).toEqual({ rows: [], buttonJoins: false })
  expect(layoutRows([10, 10, 10], 80, SEP_WIDTH, 0).rows).toEqual([[0, 1, 2]])
  // 10+5+10 = 25 fits 30; a third would need 40
  expect(layoutRows([10, 10, 10, 10], 30, SEP_WIDTH, 0).rows).toEqual([[0, 1], [2, 3]])
  const wide = layoutRows([10, 50, 10, 10], 30, SEP_WIDTH, 0).rows
  expect(wide).toEqual([[0], [1], [2, 3]])
  expect(wide.flat().sort()).toEqual([0, 1, 2, 3])
})

test('layoutRows: the button joins the last row when gap + button fits, else has its own row', () => {
  expect(layoutRows([10, 10], 40, SEP_WIDTH, 6)).toEqual({ rows: [[0, 1]], buttonJoins: true }) // 25 + 1 + 6 <= 40
  const own = layoutRows([10, 10], 30, SEP_WIDTH, 6) // 25 + 7 > 30
  expect(own).toEqual({ rows: [[0, 1]], buttonJoins: false })
  expect(rowCount(own, 6)).toBe(2)
  expect(rowCount(layoutRows([], 30, SEP_WIDTH, 6), 6)).toBe(1)
  expect(rowCount(layoutRows([10], 30, SEP_WIDTH, 0), 0)).toBe(1)
})

test('pickLayout: one text-only layout at any width; resets and head are always kept', () => {
  const at = (columns: number) => pickLayout(parts, columns, 6)
  expect(at(200).rows).toHaveLength(1)
  expect(rowCount(at(120), 6)).toBeLessThanOrEqual(2)
  expect(at(200).segments.every(s => !/[█░]/.test(s.text))).toBe(true)
  for (const columns of [200, 120, 60, 30, 10]) {
    const l = at(columns)
    expect(l.segments.map(s => s.key)).toEqual(['ctx', 'limit-5h', 'limit-7d', 'cache', 'head'])
    expect(l.segments.some(s => s.text.includes('resets'))).toBe(true)
    expect(l.rows.flat().sort()).toEqual([0, 1, 2, 3, 4])
  }
  expect(rowCount(at(30), 6)).toBeGreaterThan(2) // still more rows: nothing is cut to fit
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

test('layoutRows: the button fit is exact at used + 1 + button', () => {
  const button = [...'◆ mods'].length
  expect(button).toBe(6)
  const used = 10 + SEP_WIDTH + 10
  expect(layoutRows([10, 10], used + 1 + button, SEP_WIDTH, button).buttonJoins).toBe(true)
  expect(layoutRows([10, 10], used + button, SEP_WIDTH, button).buttonJoins).toBe(false)
  // an oversized last segment never takes the button on its row
  expect(layoutRows([50], 30, SEP_WIDTH, button).buttonJoins).toBe(false)
})
