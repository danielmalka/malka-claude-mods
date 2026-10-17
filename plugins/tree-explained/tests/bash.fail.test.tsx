import { expect, mock, test } from 'claude-code/testing'

import { bash, call, changeA, clock as clk, finish, FRESH, gits, NOW, pane, setClock, shown, start, tick, until, world } from './world'
import type { W } from './world'

const edit = ($: any, file = '/work/proj/x.ts') => $.tool.call({ tool: 'Edit', tool_use_id: `e-${file}`, file_path: file, old_string: 'a', new_string: 'a\nb' })

// three failures of the same kind pause the tracking with one toast, and then git is not asked again
const pauses = (break_: (w: W) => void) => async ($: any, on: any) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  break_(w)
  const before = gits(w, 'config').length
  for (let i = 0; i < 5; i++) await bash($)
  expect(w.toasts.length).toBe(1)
  expect(gits(w, 'config').length).toBe(before + 3)
  expect(gits(w, 'status').length).toBe(1) // the baseline only
}
test('filter discovery exiting with 2 counts as a failure', pauses(w => (w.configExit = 2)))
test('filter discovery that is rejected or times out counts as a failure', pauses(w => (w.configReject = true)))
test('filter discovery with truncated output counts as a failure', pauses(w => ((w.configTruncate = true), (w.filters = 'filter.a.clean\0'))))
test('201 filter drivers close git and count as a failure', pauses(w => (w.filters = Array.from({ length: 201 }, (_, i) => `filter.d${i}.clean\0`).join(''))))

test('discovery exit 1 (no filter defined) is not a failure', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  w.configExit = 1
  for (let i = 0; i < 5; i++) await bash($)
  expect(w.toasts).toEqual([])
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(true)
})

test('200 filter drivers are accepted', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  w.filters = Array.from({ length: 200 }, (_, i) => `filter.d${i}.clean\0`).join('')
  await bash($)
  expect(w.toasts).toEqual([])
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(true)
})

const retried = (mode: 'reject' | 'truncate') => async ($: any, on: any) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  w.numstatMode = mode
  await bash($)
  const ui = await $.ui.mount(pane)
  expect(await shown(ui, /a\.ts/)).toBe(false)
  w.numstatMode = undefined
  await bash($)
  expect(await shown(ui, /\+3/)).toBe(true)
}
test('a numstat that is rejected flags nothing; the next sweep retries the file', retried('reject'))
test('a numstat with truncated output flags nothing; the next sweep retries the file', retried('truncate'))

test('failed numstats count toward the pause', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  w.numstatMode = 'truncate'
  for (let i = 0; i < 3; i++) await bash($)
  expect(w.toasts.length).toBe(1)
})

test('numstat exit 128 (no commits) means everything is untracked: the content is counted', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  w.files.set('/work/proj/src/a.ts', { mtime: FRESH, text: 'x\ny\nz\n' })
  w.status = ' M src/a.ts\0'
  w.numstatMode = '128'
  await bash($)
  expect(w.toasts).toEqual([])
  expect(await shown(await $.ui.mount(pane), /\+3/)).toBe(true)
  expect(w.reads).toEqual(['/work/proj/src/a.ts'])
})

// a clock of the test's own, so the 5 s timer can be watched; a timer of 0 ms is due at once
function ownClock(on: any, o: { throws?: boolean } = {}) {
  const t = { started: 0, cancelled: 0 }
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => new Promise(() => undefined))
  on('clock.after', async (_$: any, e: any, next: any) => {
    if (e.ms !== 5000) return { value: undefined }
    t.started++
    if (o.throws) throw new Error('no timer')
    await new Promise(r => next.signal.addEventListener('abort', r))
    t.cancelled++
    return { value: undefined }
  })
  setClock({ advance: async () => await until(() => false, 3) })
  return t
}

test('the 5 s timer is cancelled when the sweeps finish first', async ($, on) => {
  const w = world(on, { isOn: true })
  const t = ownClock(on)
  await start($)
  changeA(w)
  await call($)
  await finish($)
  await until(() => t.cancelled > 0)
  expect(t).toEqual({ started: 1, cancelled: 1 })
})

test('a clock that cannot make the timer does not stop the turn end or its summary', async ($, on) => {
  const w = world(on, { isOn: true })
  const t = ownClock(on, { throws: true })
  await start($)
  await edit($)
  changeA(w)
  await call($)
  await finish($)
  await until(() => w.requests.length > 0)
  expect(t.started).toBe(1)
  expect(w.requests.length).toBe(1)
  expect(w.requests[0].prompt).toContain('x.ts')
})

test('a reset after one repository\'s patches: the next repository is not asked', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  await bash($)
  w.cwdNow = '/work/other'
  w.files.set('/work/other/b.ts', { mtime: FRESH })
  w.status = ' M b.ts\0'
  w.numstat = '1\t0\tb.ts\0'
  await bash($)
  let release: () => void = () => undefined
  w.gateDiff = new Promise<void>(r => (release = r))
  const before = gits(w, 'config').length
  await finish($)
  const ticking = tick()
  await until(() => gits(w, '--unified=1').length >= 1)
  await $.session.end({ sessionId: 's1', reason: 'clear' } as any).catch(() => undefined)
  release()
  await ticking
  await tick()
  expect(gits(w, 'config').length).toBe(before + 1) // the first repository's discovery only
  expect(gits(w, '--unified=1').length).toBe(1)
})
