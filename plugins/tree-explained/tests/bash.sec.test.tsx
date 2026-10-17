import { expect, mock, test } from 'claude-code/testing'

import { bash, changeA, finish, FRESH, gits, NOW, pane, setClock, shown, start, tick, until, world } from './world'

test('secret-named files are listed by name only: never read, never named to a content-deriving git command', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  for (const n of ['.env', '.env.local', 'id_ed25519']) w.files.set(`/work/proj/${n}`, { mtime: FRESH, text: 'HUNTER2_VALUE' })
  w.files.set('/work/proj/src/a.ts', { mtime: FRESH })
  w.status = ' M .env\0?? .env.local\0?? id_ed25519\0 M src/a.ts\0'
  w.numstat = '9\t9\t.env\0' + '3\t1\tsrc/a.ts\0'
  w.patch = 'diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-HUNTER2_OLD\n+HUNTER2_NEW\n' + 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,3 @@\n-a\n+b\n+c\n'
  await bash($)
  const ui = await $.ui.mount(pane)
  for (const n of [/\.env\.local/, /id_ed25519/, /a\.ts/]) expect(await shown(ui, n)).toBe(true)
  expect(await shown(ui, /\+3/)).toBe(true)
  expect(await shown(ui, /\+9/)).toBe(false)
  expect(w.reads).toEqual([])
  for (const argv of [...gits(w, '--numstat'), ...gits(w, '--unified=1')]) {
    const paths = argv.slice(argv.indexOf('--', argv.indexOf('diff')) + 1)
    expect(paths).toEqual(['src/a.ts'])
  }
  await finish($)
  await tick()
  await tick()
  const text = w.requests.map(r => r.prompt).join()
  expect(text).toContain('+c')
  expect(text).not.toContain('HUNTER2')
})

test('a link that appears between the first stat and the read: nothing is read through it', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  w.files.set('/work/proj/swap.txt', { mtime: FRESH, text: 'TARGET_CONTENT', linkOnResolve: true })
  w.files.set('/work/proj/nul.txt', { mtime: FRESH, text: 'ab\0cd' })
  w.status = '?? swap.txt\0?? nul.txt\0'
  await bash($)
  const ui = await $.ui.mount(pane)
  expect(await shown(ui, /swap\.txt/)).toBe(true)
  expect(await shown(ui, /nul\.txt/)).toBe(true)
  expect(w.reads).toEqual(['/work/proj/nul.txt'])
  expect(await shown(ui, /\+[1-9]/)).toBe(false)
})

test('a failing discovery in the second repository keeps the first one\'s patches', async ($, on) => {
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
  w.configFailDir = '/work/other'
  await finish($)
  await tick()
  await tick()
  expect(w.requests.length).toBe(1)
  expect(w.requests[0].prompt).toContain('+c')
})

test('truncated patch spawns count toward the pause', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  const names = Array.from({ length: 250 }, (_, i) => `f${String(i).padStart(3, '0')}.ts`)
  for (const n of names) w.files.set(`/work/proj/${n}`, { mtime: FRESH })
  w.status = names.map(n => ` M ${n}\0`).join('')
  w.numstat = names.map(n => `1\t0\t${n}\0`).join('')
  await bash($)
  w.patchTruncate = true
  await finish($)
  await tick()
  await until(() => gits(w, '--unified=1').length >= 3)
  await tick()
  expect(gits(w, '--unified=1').length).toBe(3)
  expect(w.toasts.length).toBe(1)
})

test('a file that resolves outside the repository (a linked folder above it) is not read', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  w.files.set('/work/proj/linked/x.txt', { mtime: FRESH, text: 'OUTSIDE_CONTENT' })
  w.real.set('/work/proj/linked/x.txt', '/elsewhere/x.txt')
  w.status = '?? linked/x.txt\0'
  await bash($)
  expect(await shown(await $.ui.mount(pane), /x\.txt/)).toBe(true)
  expect(w.reads).toEqual([])
})

test('a repository rooted inside a secret folder sends nothing: judged on the absolute path', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  w.cwdNow = '/h/.aws'
  w.files.set('/h/.aws/config', { mtime: FRESH, text: 'AWS_SECRET_X' })
  w.files.set('/h/.aws/tracked.txt', { mtime: FRESH })
  w.status = '?? config\0 M tracked.txt\0'
  w.numstat = '2\t0\ttracked.txt\0'
  await bash($)
  expect(await shown(await $.ui.mount(pane), /config/)).toBe(true)
  expect(w.reads).toEqual([])
  expect(gits(w, '--numstat').length).toBe(0) // every path is secret: none is named to git
  await finish($)
  await tick()
  await tick()
  expect(w.requests.map(r => r.prompt).join()).not.toContain('AWS_SECRET_X')
})

test('at most 2000 dirty entries are looked at per sweep', async ($, on) => {
  setClock(mock.clock(on, { now: NOW }))
  const w = world(on, { isOn: true })
  await start($)
  const names = Array.from({ length: 2100 }, (_, i) => `g${String(i).padStart(4, '0')}.ts`)
  for (const n of names) w.files.set(`/work/proj/${n}`, { mtime: FRESH })
  w.status = names.map(n => ` M ${n}\0`).join('')
  w.statPaths = []
  await bash($)
  expect(w.statPaths.filter(p => p.includes('/g')).length).toBe(2000)
})
