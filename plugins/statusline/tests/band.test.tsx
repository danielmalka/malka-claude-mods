import { expect, mock, test } from 'claude-code/testing'

import { band, engine, run, SETTINGS } from './harness'
import { pickLayout, SEP_WIDTH } from '../hooks/status'

// The data the stubbed engine produces once a response was stamped (the reset times are in the past: `0s`).
const parts = {
  ctxText: '41% 82k/200k',
  limits: [
    { label: '5h', percentText: '30%', resetText: ' (resets 0s)' },
    { label: '7d', percentText: '12%', resetText: ' (resets 0s)' },
  ],
  cacheText: '● cache ok',
  head: 'Opus 5.5 · proj · main',
}

async function ready($: any, on: any) {
  mock.clock(on, { now: 0 })
  const { setState } = engine(on, { files: { [SETTINGS]: '{}' } })
  setState('menu.present', true)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  await run($, 'on')
  const gen: any = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })
  for await (const _ of gen) void _
}

// The band's rows as drawn: content rows (key row-N), and whether the button has a row of its own.
async function rowsOf(ui: any) {
  const boxes: any[] = await ui.findAll({ type: 'Box' })
  const rows = boxes.filter(b => /^row-\d+$/.test(b.key ?? ''))
  return { rows, ownButtonRow: boxes.some(b => b.key === 'row-button') }
}
const cellsOf = (row: any): any[] => row.children[0].children
const isSep = (c: any) => c.type === 'Text' && c.children[0] === '  │  '
const hasButton = (row: any) => row.children.some((c: any) => c.type === 'Button')

const usedBy = (indices: number[], widths: number[]) => indices.reduce((n, i) => n + widths[i]!, 0) + SEP_WIDTH * (indices.length - 1)

test('button fit boundary: joins at columns == used + 1 + label width, own row one column below', async ($, on) => {
  await ready($, on)
  // the width comes from the label the hook really passes, so dropping the glyph from the count fails here
  const label = ((await (await $.ui.mount(band(140))).find({ key: 'mods-open' })) as any).props.label as string
  const w = [...label].length
  expect(label).toBe('◆ mods')
  let boundary = 0
  for (let c = 30; c <= 200 && boundary === 0; c++) {
    const l = pickLayout(parts, c, w)
    const prev = pickLayout(parts, c - 1, w)
    const used = usedBy(l.rows[l.rows.length - 1]!, l.segments.map(s => [...s.text].length))
    if (l.buttonJoins && c === used + 1 + w && !prev.buttonJoins && JSON.stringify(prev.rows) === JSON.stringify(l.rows) && prev.withBars === l.withBars) boundary = c
  }
  expect(boundary).toBeGreaterThan(0)
  const at = await rowsOf(await $.ui.mount(band(boundary)))
  expect(at.ownButtonRow).toBe(false)
  expect(hasButton(at.rows[at.rows.length - 1])).toBe(true)
  const below = await rowsOf(await $.ui.mount(band(boundary - 1)))
  expect(below.ownButtonRow).toBe(true)
  expect(below.rows).toHaveLength(at.rows.length)
  expect(below.rows.some(hasButton)).toBe(false)
})

for (const width of [60, 40, 20]) {
  test(`bodyColumns ${width}: a separator only between two segments of one row, never first on a row`, async ($, on) => {
    await ready($, on)
    const { rows } = await rowsOf(await $.ui.mount(band(width)))
    expect(rows.length).toBeGreaterThan(1) // wrapped
    let seps = 0
    let segments = 0
    for (const row of rows) {
      const cells = cellsOf(row)
      expect(isSep(cells[0])).toBe(false)
      expect(isSep(cells[cells.length - 1])).toBe(false)
      seps += cells.filter(isSep).length
      segments += cells.filter(c => !isSep(c)).length
    }
    expect(segments).toBe(5) // ctx, 5h, 7d, cache, head: none dropped
    expect(seps).toBe(segments - rows.length)
  })
}
