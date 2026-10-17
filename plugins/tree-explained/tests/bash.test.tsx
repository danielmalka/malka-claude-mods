import { expect, mock, test } from 'claude-code/testing'

import { bash, call, changeA, finish, FRESH, gits, NOW, pane, setClock, shown, start, tick, until, world } from './world'
import { clock as clk } from './world'

test('a Bash call that changes a file: edit row with the numstat total, folder above open', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  await bash($)
  const ui = await $.ui.mount(pane)
  expect(await shown(ui, /a\.ts/)).toBe(true)
  expect(await shown(ui, /\+3/)).toBe(true)
  expect(await shown(ui, /-1/)).toBe(true)
  expect(gits(w, 'rev-parse').length).toBe(1)
  expect(w.calls.filter(c => c[1] !== '--version').every(c => c[0] === 'git' && c.includes('--no-optional-locks') && c.includes('--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904'))).toBe(true)
  expect(w.calls.filter(c => c[1] === '--version').length).toBe(1) // asked once
})

test('read-only Bash and a denied Bash run no git', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  let mode = 'ro'
  const w = world(on, { isOn: true, bash: () => (mode === 'ro' ? { result: {}, isReadOnly: true } : { deny: 'no' }) })
  await start($)
  changeA(w)
  const before = w.calls.length
  await bash($)
  mode = 'deny'
  await bash($)
  expect(w.calls.length).toBe(before)
})

test('a mod that is off runs no git', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { bash: () => ({ result: {} }) })
  await start($)
  changeA(w)
  await bash($)
  expect(w.calls).toEqual([])
})

test('a failed Bash (isError) with a changed file still shows it', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true, bash: () => ({ isError: true, result: 'exit 1', text: 'exit 1' }) })
  await start($)
  changeA(w)
  await bash($)
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(true)
})

test('a background Bash: no sweep at the call, one when the turn ends', async ($, on) => {
  const clock = setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true, bash: () => ({ result: { backgroundTaskId: 'bg1' } }) })
  await start($)
  const before = w.calls.length
  changeA(w)
  await bash($)
  expect(w.calls.length).toBe(before)
  await finish($)
  expect(gits(w, 'status').length).toBe(2) // the baseline and the one at the turn end
  await clock.advance(0)
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(true)
  await finish($)
  expect(gits(w, 'status').length).toBe(2)
})

test('outside a git repository: nothing shows, nothing throws, no failure counted', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  w.isRepo = false
  await start($)
  changeA(w)
  for (let i = 0; i < 5; i++) await bash($)
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(false)
  expect(w.toasts).toEqual([])
  expect(gits(w, 'rev-parse').length).toBe(1) // cached
})

test('git failing three times in a row pauses the tracking with one toast', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  const before = w.calls.length
  w.fail = true
  for (let i = 0; i < 6; i++) await bash($)
  expect(w.toasts.length).toBe(1)
  expect(w.toasts[0]).toContain('paused')
  expect(w.calls.length).toBe(before + 3) // three failures, then no more
})

test('a Bash-only turn is an edit turn: the model gets the patch, a secret name is withheld, the command text never goes', async ($, on) => {
  const clock = setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  w.files.set('/work/proj/.env', { mtime: FRESH })
  w.status = ' M src/a.ts\0 M .env\0'
  w.numstat = '3\t1\tsrc/a.ts\0 1\t1\t.env\0'.replace(' 1', '1')
  w.patch += 'diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-T=hunter2\n+T=hunter3\n'
  await bash($)
  await finish($)
  await clock.advance(0)
  await clock.advance(0)
  expect(w.requests.length).toBe(1)
  const text = w.requests[0].system + w.requests[0].prompt
  expect(text).toContain('### edit src/a.ts +3 -1')
  expect(text).toContain('+c')
  expect(text).toContain('[content withheld')
  expect(text).not.toContain('hunter')
  expect(text).not.toContain('SECRET_CMD_TEXT')
  expect(gits(w, '--unified=1').length).toBe(1)
  expect(gits(w, '--unified=1')[0]!.includes('.env')).toBe(false)
})

test('an untracked file counts its lines; a deleted one is an edit row with -N', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  w.files.set('/work/proj/new.ts', { mtime: FRESH, text: 'a\nb\nc\nd\n' })
  w.status = '?? new.ts\0 D old.ts\0'
  w.numstat = '0\t9\told.ts\0'
  await bash($)
  const ui = await $.ui.mount(pane)
  expect(await shown(ui, /new\.ts/)).toBe(true)
  expect(await shown(ui, /old\.ts/)).toBe(true)
  expect(await shown(ui, /\+4/)).toBe(true)
  expect(await shown(ui, /-9/)).toBe(true)
})

test('two overlapping sweeps report one file once', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  await Promise.all([bash($, { tool_use_id: 'x1' }), bash($, { tool_use_id: 'x2' })])
  expect(gits(w, '--numstat').length).toBe(1)
})

test('a reset while a sweep runs drops it', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  let release: () => void = () => undefined
  w.gate = new Promise<void>(r => (release = r))
  await call($)
  const ticking = tick()
  await until(() => gits(w, 'status').length >= 2) // wait until the sweep is inside git
  expect(gits(w, 'status').length).toBe(2)
  await $.session.end({ sessionId: 's1', reason: 'clear' } as any).catch(() => undefined)
  release()
  await ticking
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(false)
})

test('an Edit then a sweep does not replace the summed counters', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  w.files.set('/work/proj/src/a.ts', { mtime: FRESH })
  const edit = () => $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: '/work/proj/src/a.ts', old_string: 'a', new_string: 'a\nb\nc\nd\ne\nf' })
  await edit()
  await edit()
  w.status = ' M src/a.ts\0'
  w.numstat = '1\t0\tsrc/a.ts\0'
  await bash($)
  const ui = await $.ui.mount(pane)
  expect(await shown(ui, /\+12/)).toBe(true)
  expect(gits(w, '--numstat').length).toBe(0)
})

test('files already dirty when the mod starts are not reported', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  changeA(w, NOW - 100) // dirty before, modified within the slack
  await start($)
  await bash($)
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(false)
})

test('a subagent Bash call is tracked like the main one', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  await bash($, { agentId: 'agent-1' })
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(true)
})

test('an untracked symlink or any non-regular entry is listed by name only: its target is never read', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  w.files.set('/work/proj/link.txt', { mtime: FRESH, text: 'TARGET_SECRET_CONTENT', link: true })
  w.files.set('/work/proj/pipe', { mtime: FRESH, text: 'FIFO_CONTENT', kind: 'other' })
  w.files.set('/work/proj/dir', { mtime: FRESH, text: 'DIR_CONTENT', kind: 'dir' })
  w.files.set('/work/proj/plain.txt', { mtime: FRESH, text: 'x\ny\n' })
  w.status = '?? link.txt\0?? pipe\0?? dir\0?? plain.txt\0'
  await bash($)
  const ui = await $.ui.mount(pane)
  for (const n of [/link\.txt/, /pipe/, /dir/, /plain\.txt/]) expect(await shown(ui, n)).toBe(true)
  expect(w.reads).toEqual(['/work/proj/plain.txt'])
  expect(await shown(ui, /\+2/)).toBe(true)
  await finish($)
  await tick()
  const text = w.requests.map(r => r.prompt).join()
  expect(text).toContain('plain.txt')
  expect(text).not.toContain('TARGET_SECRET_CONTENT')
})

test('a truncated or failed status aborts the sweep and counts toward the pause', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  w.truncate = true
  await bash($)
  await bash($)
  expect(w.toasts).toEqual([])
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(false)
  await bash($)
  expect(w.toasts.length).toBe(1)
  expect(gits(w, '--numstat')).toEqual([])
})

test('a status entry whose stat fails is skipped, never read as a delete', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  w.status = ' M ghost.ts\0?? ghost2.ts\0'
  await bash($)
  expect(await shown(await $.ui.mount(pane), /ghost/)).toBe(false)
  expect(gits(w, '--numstat')).toEqual([])
})

test('a file deleted, restored and deleted again is reported again', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  w.status = ' D old.ts\0'
  w.numstat = '0\t4\told.ts\0'
  await bash($)
  await bash($)
  expect(gits(w, '--numstat').length).toBe(1) // once while it stays deleted
  w.status = ''
  await bash($)
  w.status = ' D old.ts\0'
  await bash($)
  expect(gits(w, '--numstat').length).toBe(2)
})

test('a folder that is not a repository is asked again after 30 seconds', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  w.isRepo = false
  await start($)
  await bash($)
  expect(gits(w, 'rev-parse').length).toBe(1)
  w.isRepo = true
  changeA(w)
  await bash($)
  expect(gits(w, 'rev-parse').length).toBe(1)
  await clk.c.advance(31_000)
  w.files.set('/work/proj/src/a.ts', { mtime: NOW + 31_500 })
  await bash($)
  expect(gits(w, 'rev-parse').length).toBe(2)
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(true)
})

test('a session folder behind a symlink: files are classified against its realpath, not marked outside', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  w.real.set('/work/proj', '/real/proj')
  w.top = '/real/proj'
  await start($)
  w.files.set('/real/proj/src/a.ts', { mtime: FRESH })
  w.status = ' M src/a.ts\0'
  w.numstat = '3\t1\tsrc/a.ts\0'
  await bash($)
  const ui = await $.ui.mount(pane)
  expect(await shown(ui, /a\.ts/)).toBe(true)
  expect(await shown(ui, /outside project/)).toBe(false)
})

test('patches are not fetched for a session that was reset before the turn ended', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  await bash($)
  await finish($)
  await $.session.end({ sessionId: 's1', reason: 'clear' } as any).catch(() => undefined)
  await tick()
  expect(gits(w, '--unified=1')).toEqual([])
})

test('the Bash result does not wait for git; the turn end waits for the sweep, which lands in the summary', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  let release: () => void = () => undefined
  w.gate = new Promise<void>(r => (release = r))
  await call($) // returns although git has not even been asked
  expect(gits(w, 'status').length).toBe(1) // the baseline only
  const ticking = tick()
  await until(() => gits(w, 'status').length >= 2)
  expect(gits(w, 'status').length).toBe(2) // asked, and still waiting
  let finished = false
  const turn = finish($).then(() => (finished = true))
  await until(() => false, 10)
  expect(finished).toBe(false) // the turn end waits for the running sweep
  release()
  await ticking
  await turn
  await tick()
  await tick()
  expect(w.requests.length).toBe(1)
  expect(w.requests[0].prompt).toContain('### edit src/a.ts')
})

test('a sweep scheduled before a reset is dropped when it runs', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  await call($)
  await $.session.end({ sessionId: 's1', reason: 'clear' } as any).catch(() => undefined)
  await tick()
  expect(await shown(await $.ui.mount(pane), /a\.ts/)).toBe(false)
  expect(gits(w, 'status').length).toBe(1)
})

test('three failures pause the tracking through the deferred path too', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  changeA(w)
  const before = w.calls.length
  w.fail = true
  for (let i = 0; i < 5; i++) await bash($)
  expect(w.toasts.length).toBe(1)
  expect(w.calls.length).toBe(before + 3)
})
