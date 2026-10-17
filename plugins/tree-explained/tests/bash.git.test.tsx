import { expect, mock, test } from 'claude-code/testing'

import { bash, call, changeA, clock as clk, finish, FRESH, gits, NOW, pane, setClock, shown, start, tick, until, world } from './world'

const edit = ($: any, file = '/work/proj/x.ts') => $.tool.call({ tool: 'Edit', tool_use_id: `e-${file}`, file_path: file, old_string: 'a', new_string: 'a\nb' })

test('a status that exits non-zero aborts the sweep and counts toward the pause', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  w.statusExit = 128
  for (let i = 0; i < 4; i++) await bash($)
  expect(w.toasts.length).toBe(1)
  expect(gits(w, '--numstat')).toEqual([])
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(false)
})

test('an Edit under a symlinked session folder is not flagged again by the next sweep', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  w.real.set('/work/proj', '/real/proj')
  w.real.set('/work/proj/src/a.ts', '/real/proj/src/a.ts')
  w.top = '/real/proj'
  await start($)
  w.files.set('/work/proj/src/a.ts', { mtime: FRESH })
  w.files.set('/real/proj/src/a.ts', { mtime: FRESH })
  const e = () => $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: '/work/proj/src/a.ts', old_string: 'a', new_string: 'a\nb\nc' })
  await e()
  w.status = ' M src/a.ts\0'
  w.numstat = '1\t0\tsrc/a.ts\0'
  await bash($)
  expect(gits(w, '--numstat')).toEqual([])
  expect(await shown(await $.ui.mount(pane), /\+3/)).toBe(true)
})

test('a reset while the patches are being prepared: no git spawn after it', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  await bash($)
  let release: () => void = () => undefined
  w.gateConfig = new Promise<void>(r => (release = r))
  const before = gits(w, 'config').length
  await finish($)
  const ticking = tick()
  await until(() => gits(w, 'config').length > before)
  await $.session.end({ sessionId: 's1', reason: 'clear' } as any).catch(() => undefined)
  release()
  await ticking
  await tick()
  expect(gits(w, '--unified=1')).toEqual([])
})

test('a reset while the session folder is resolved drops the sweep', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  let release: () => void = () => undefined
  w.statGate = new Promise<void>(r => (release = r))
  await call($)
  const ticking = tick()
  await until(() => w.statHit)
  expect(w.statHit).toBe(true)
  await $.session.end({ sessionId: 's1', reason: 'clear' } as any).catch(() => undefined)
  release()
  await ticking
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(false)
})

const tooOld = (version: string) => async ($: any, on: any) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  w.version = version
  await start($)
  changeA(w)
  for (let i = 0; i < 5; i++) await bash($)
  expect(w.calls.map(c => c[1])).toEqual(['--version'])
  expect(w.toasts.length).toBe(1)
  expect(w.toasts[0]).toContain('2.45')
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(false)
}
test('an old git (2.44): no other git command runs, one toast, nothing counted', tooOld('git version 2.44.9\n'))
test('an unreadable git version: the same', tooOld('garbage'))

test('the repository filter drivers are replaced by cat in status and diff', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  w.filters = 'filter.cl.clean\0filter.pr.process\0'
  await start($)
  changeA(w)
  await bash($)
  await finish($)
  await tick()
  await tick()
  for (const sub of ['status', '--numstat', '--unified=1']) {
    const argv = gits(w, sub)[0]!
    expect(argv).toContain('filter.cl.clean=cat')
    expect(argv).toContain('filter.pr.process=')
  }
  expect(w.envs.every(e => e.GIT_ATTR_NOSYSTEM === '1' && e.GIT_OPTIONAL_LOCKS === '0' && e.GIT_PAGER === 'cat')).toBe(true)
})

test('a filter name -c cannot spell stops git before status', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const bad = world(on, { isOn: true })
  bad.filters = 'filter.a=b.clean\0'
  await start($)
  changeA(bad)
  await bash($)
  expect(gits(bad, 'status')).toEqual([])
})

test('the turn end waits for a slow sweep only for a bounded time; the late result goes to the next turn', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  await edit($)
  changeA(w)
  let release: () => void = () => undefined
  w.gate = new Promise<void>(r => (release = r))
  await call($)
  const ticking = tick()
  await until(() => gits(w, 'status').length >= 2)
  let finished = false
  const turn = finish($).then(() => (finished = true))
  await until(() => false, 10)
  expect(finished).toBe(false)
  await clk.c.advance(5000)
  await turn
  await tick()
  await tick()
  expect(w.requests.length).toBe(1)
  expect(w.requests[0].prompt).toContain('x.ts')
  expect(w.requests[0].prompt).not.toContain('a.ts')
  release()
  await ticking
  await tick()
  await finish($)
  await tick()
  await tick()
  expect(w.requests.length).toBe(2)
  expect(w.requests[1].prompt).toContain('### edit src/a.ts')
})

test('a sweep that was aborted does not move the mark: the next one still sees the file', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  await clk.c.advance(5000)
  changeA(w, NOW + 500) // written a little after the baseline, before the aborted sweep
  w.statusExit = 128
  await bash($)
  w.statusExit = 0
  await clk.c.advance(5000)
  await bash($)
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(true)
})

test('failures that land after a reset pause nothing and toast nothing', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  let release: () => void = () => undefined
  w.gateConfig = new Promise<void>(r => (release = r))
  const before = gits(w, 'config').length
  await Promise.all([call($, { tool_use_id: 'a' }), call($, { tool_use_id: 'b' }), call($, { tool_use_id: 'c' })])
  const ticking = tick()
  await until(() => gits(w, 'config').length >= before + 3)
  w.fail = true
  await $.session.end({ sessionId: 's1', reason: 'clear' } as any).catch(() => undefined)
  release()
  await ticking
  await tick()
  expect(w.toasts).toEqual([])
})

test('a reset while the first chunk of patches is fetched: the next chunk is not asked', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  const names = Array.from({ length: 150 }, (_, i) => `f${String(i).padStart(3, '0')}.ts`)
  for (const n of names) w.files.set(`/work/proj/${n}`, { mtime: FRESH })
  w.status = names.map(n => ` M ${n}\0`).join('')
  w.numstat = names.map(n => `1\t0\t${n}\0`).join('')
  await bash($)
  let release: () => void = () => undefined
  w.gateDiff = new Promise<void>(r => (release = r))
  await finish($)
  const ticking = tick()
  await until(() => gits(w, '--unified=1').length >= 1)
  await $.session.end({ sessionId: 's1', reason: 'clear' } as any).catch(() => undefined)
  release()
  await ticking
  await tick()
  expect(gits(w, '--unified=1').length).toBe(1)
})

test('a reset forgets the sweeps still running: the next turn end does not wait for them', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  let release: () => void = () => undefined
  w.gate = new Promise<void>(r => (release = r))
  await call($)
  const ticking = tick()
  await until(() => gits(w, 'status').length >= 2)
  await $.session.end({ sessionId: 's1', reason: 'clear' } as any).catch(() => undefined)
  await finish($) // would wait on the dead session's sweep (and time out here) if it were still tracked
  release()
  await ticking
})
