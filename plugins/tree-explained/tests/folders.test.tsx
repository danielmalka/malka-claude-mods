import { expect, mock, test } from 'claude-code/testing'

const ok = { value: undefined } as any
const pane = { plugin: 'tree-explained', surface: 'terminal', component: 'Pane', requestId: 'tree-explained', props: { bodyColumns: 50, placement: 'dock', scroll: { bodyRows: 20 }, view: {} } } as any

// what the engine would answer beneath the plugin; `cwd` is mutable, `scrolls` records every scroll that reaches the engine
function engine(on: any, store: Record<string, unknown> = {}) {
  const st = { store, cwd: '/work/proj', scrolls: [] as any[], vals: new Map<string, unknown>() }
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: any, e: any) => ((store[e.key] = e.value), ok))
  on('store.delete', (_$: any, e: any) => (delete store[e.key], ok))
  on('state.get', (_$: any, e: any, next: any) => (e.plugin === 'menu' ? { value: { value: undefined, version: 0 } } : next(e)))
  on('state.set', (_$: any, e: any, next: any) => (st.vals.set(`${e.plugin}.${e.key}`, e.value), next(e)))
  on('command.register', () => ok)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ok)
  on('session.cwd', () => ({ value: st.cwd }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('ui.scroll', (_$: any, e: any) => (st.scrolls.push(e), {}))
  on('ui.render', async ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  on('tool.call', () => ({ result: 'ok' }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Headline\n- x', usage: {} } }))
  return st
}

const start = ($: any) => $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
const tool = ($: any, t: string, file: string, id = `${t}-${file}`) =>
  $.tool.call({ tool: t, tool_use_id: id, file_path: file, old_string: 'a', new_string: 'a\nb', content: 'x\n' })
const read = ($: any, file: string) => tool($, 'Read', file)
const edit = ($: any, file: string) => tool($, 'Edit', file)
const names = async (ui: any) => ((await ui.findAll({ type: 'Text' })) ?? []).map((t: any) => String(t.props?.children ?? ''))

test('folders start closed; an edit opens its ancestors, a read opens nothing', async ($, on) => {
  mock.clock(on, { now: 0 })
  const st = engine(on)
  await start($)
  await read($, '/work/proj/docs/r.md')
  expect(st.vals.get('tree-explained.open')).toEqual([])
  await edit($, '/work/proj/src/lib/x.ts')
  expect(st.vals.get('tree-explained.open')).toEqual(['src', 'src/lib'])
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ key: 'dir:docs' })).toBeDefined()
  expect(await ui.find({ key: 'dir:src/lib' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /x\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /r\.md/ })).toBeUndefined()
})

test('a folder Button toggles it; the next edit reopens a folder the person closed', async ($, on) => {
  mock.clock(on, { now: 0 })
  const st = engine(on)
  await start($)
  await edit($, '/work/proj/src/a.ts')
  const ui = await $.ui.mount(pane)
  await ui.press({ key: 'dir:src' })
  expect(st.vals.get('tree-explained.open')).toEqual([])
  await ui.press({ key: 'dir:src' })
  expect(st.vals.get('tree-explained.open')).toEqual(['src'])
  await ui.press({ key: 'dir:src' })
  await edit($, '/work/proj/src/b.ts')
  expect(st.vals.get('tree-explained.open')).toEqual(['src'])
})

const has = async (ui: any, text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
// the kit passes `$.ui.scroll`'s argument to the hooks as the event, so a person-origin ui.scroll can be raised by spelling it out
const personScroll = ($: any) =>
  $.ui.scroll({ component: 'Pane', requestId: 'tree-explained', offset: 3, by: 1, bodyRows: 10, contentRows: 40, origin: { kind: 'person' } } as any)

test('a closed folder shows its counts and the +N -N sum; open, it shows its children instead', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  await start($)
  const ui = await $.ui.mount(pane)
  await edit($, '/work/proj/src/a.ts')
  await read($, '/work/proj/src/b.ts')
  expect(await has(ui, /b\.ts/)).toBe(true)
  expect(await has(ui, /1 edit, 1 read/)).toBe(false)
  await ui.press({ key: 'dir:src' })
  expect(await has(ui, /\(1 edit, 1 read\)/)).toBe(true)
  expect(await has(ui, /\+2/)).toBe(true)
  expect(await has(ui, /b\.ts/)).toBe(false)
})

test('header hotkeys c e r t s: collapse, expand, hide reads, hide sections; flags persist in the store', async ($, on) => {
  mock.clock(on, { now: 0 })
  const st = engine(on)
  await start($)
  await edit($, '/work/proj/src/a.ts')
  await read($, '/work/proj/docs/r.md')
  const ui = await $.ui.mount(pane)
  for (const k of ['c', 'e', 'r', 't', 's']) expect((await ui.find({ key: `hk-${k}` })).props.hotkey).toBe(k)
  await ui.press({ key: 'hk-c' })
  expect(st.vals.get('tree-explained.open')).toEqual([])
  await ui.press({ key: 'hk-e' })
  expect([...(st.vals.get('tree-explained.open') as string[])].sort()).toEqual(['docs', 'src'])
  await ui.press({ key: 'hk-r' })
  expect(st.store.readsHidden).toBe(true)
  expect(await ui.find({ key: 'dir:docs' })).toBeUndefined()
  await ui.press({ key: 'hk-t' })
  await ui.press({ key: 'hk-s' })
  expect([st.store.treeHidden, st.store.summaryHidden]).toEqual([true, true])
  expect(await has(ui, /files \(2\)/)).toBe(true)
  expect(await has(ui, /summary \(0\)/)).toBe(true)
  expect(await ui.find({ key: 'dir:src' })).toBeUndefined()
  await ui.press({ key: 'hk-t' })
  expect(st.store.treeHidden).toBe(false)
  expect(await ui.find({ key: 'dir:src' })).toBeDefined()
})

test('the flags are read from the store at session start and survive a clear', async ($, on) => {
  mock.clock(on, { now: 0 })
  const st = engine(on, { treeHidden: true, summaryHidden: true, readsHidden: true })
  await start($)
  expect([st.vals.get('tree-explained.treeHidden'), st.vals.get('tree-explained.summaryHidden'), st.vals.get('tree-explained.readsHidden')]).toEqual([true, true, true])
  await edit($, '/work/proj/src/a.ts')
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's0' } } as any)
  expect(st.vals.get('tree-explained.open')).toEqual([])
  expect(st.vals.get('tree-explained.readsHidden')).toBe(true)
})

test('outside files: one closed row with a count, an outside edit reopens it, no absolute chains', async ($, on) => {
  mock.clock(on, { now: 0 })
  const st = engine(on)
  await start($)
  const ui = await $.ui.mount(pane)
  await read($, '/opt/lib/deep/x.ts')
  await read($, '/proj-other/y.ts')
  expect(await has(ui, /\(outside project\)/)).toBe(true)
  expect(await has(ui, /\(2 files, 2 reads\)/)).toBe(true)
  expect(await has(ui, /\/opt/)).toBe(false)
  expect(await has(ui, /x\.ts/)).toBe(false)
  await ui.press({ key: 'dir:(outside project)' })
  expect(await has(ui, /deep\/x\.ts/)).toBe(true)
  expect(await has(ui, /\/opt/)).toBe(false)
  await ui.press({ key: 'dir:(outside project)' })
  await edit($, '/opt/lib/z.ts')
  expect(st.vals.get('tree-explained.open')).toEqual(['(outside project)'])
  expect(await has(ui, /lib\/z\.ts/)).toBe(true)
})

test('cwd is re-read on every call: a cd moves what counts as inside', async ($, on) => {
  mock.clock(on, { now: 0 })
  const st = engine(on)
  await start($)
  await edit($, '/work/proj/a.ts')
  st.cwd = '/work/other'
  await edit($, '/work/other/b.ts')
  await edit($, '/work/proj/c.ts')
  const files = st.vals.get('tree-explained.files') as Record<string, any>
  expect(Object.keys(files).sort()).toEqual(['/work/proj/c.ts', 'a.ts', 'b.ts'])
  expect(files['/work/proj/c.ts'].outside).toBe(true)
})

// A person-origin scroll sets the manual flag (raised through the kit as above). The kit has no implementation of a plugin's own $.ui.scroll ("no implementation for ui.scroll"), so the call itself cannot be observed
// here: the test covers its target (a keyed row that exists) and the manual flag that gates it and shows `f`.
test('follow: the touched file is a keyed row; `f` shows only while manual, and `f` or the next prompt clears it', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const st = engine(on)
  await start($)
  await $.command.run({ command: 'tree-explained', args: '' })
  const ui = await $.ui.mount(pane)
  await edit($, '/work/proj/src/a.ts')
  await clock.advance(0) // the follow runs; the kit's missing scroll implementation is swallowed, not thrown into the hook
  expect(await ui.find({ key: 'row-src/a.ts' })).toBeDefined()
  expect(await ui.find({ key: 'hk-f' })).toBeUndefined()
  await $.ui.scroll({ component: 'Pane', requestId: 'tree-explained', offset: 1, by: 1, bodyRows: 10, contentRows: 40, origin: { kind: 'plugin', name: 'tree-explained' } } as any)
  expect(await ui.find({ key: 'hk-f' })).toBeUndefined() // the pane's own moves do not stop the follow
  await personScroll($)
  expect(await ui.find({ key: 'hk-f' })).toBeDefined()
  await ui.press({ key: 'hk-f' })
  expect(st.vals.get('tree-explained.manual')).toBe(false)
  expect(await ui.find({ key: 'hk-f' })).toBeUndefined()
  await personScroll($)
  await $.prompt.submit({ text: 'next', wait: false })
  expect(st.vals.get('tree-explained.manual')).toBe(false)
})
