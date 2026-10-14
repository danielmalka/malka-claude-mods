import { expect, mock, test } from 'claude-code/testing'

const ok = { value: undefined } as any
const SETTINGS = '/cfg/settings.json'
const BAK = `${SETTINGS}.statusline.bak`
const USER_LINE = { type: 'command', command: 'echo mine' }

const hintProps = { hint: 'esc to interrupt', columns: 140 } as any
const hint = { plugin: 'statusline', surface: 'terminal', component: 'PromptHint', props: hintProps, viewport: { columns: 140, rows: 40 } } as any
const menuPane = (panel: string) => ({ plugin: 'statusline', surface: 'terminal', component: 'Pane', requestId: 'mods-menu', props: { bodyColumns: 60, scroll: { bodyRows: 10 }, view: {} } }) as any

// what the engine would answer beneath the plugin
function engine(on: any, opts: { store?: Record<string, unknown>; files?: Record<string, string>; menu?: Record<string, unknown>; noUsage?: boolean; pct?: () => number } = {}) {
  const store = opts.store ?? {}
  const toasts: string[] = []
  const opened: string[] = []
  const files = opts.files ?? { [SETTINGS]: JSON.stringify({ theme: 'x', statusLine: USER_LINE }) }
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('fs.exists', (_$: any, e: any) => ({ value: e.path in files }))
  on('fs.read', (_$: any, e: any) => ({ value: files[e.path] }))
  on('fs.write', (_$: any, e: any) => ((files[e.path] = e.content ?? e.text ?? e.data), ok))
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: any, e: any) => ((store[e.key] = e.value), ok))
  on('store.delete', (_$: any, e: any) => (delete store[e.key], ok))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: '/work/proj' }))
  on('session.usage', () => (opts.noUsage ? Promise.reject(new Error('no usage yet')) : {
    value: { context: { percent: opts.pct ? opts.pct() : 41, tokens: 82_000, window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: new Date(3_600_000).toISOString() }] },
  }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main\n', stderr: '' } }))
  // the host's named values: the plugin's own writes land here, and a test plays the menu mod by writing its keys
  const vals = new Map<string, unknown>()
  const ver = new Map<string, number>()
  on('state.get', (_$: any, e: any, next: any) => {
    const k = `${e.plugin}.${e.key}`
    return e.plugin === 'menu' ? { value: { value: vals.get(k), version: ver.get(k) ?? 0 } } : next(e)
  })
  const order: string[] = []
  on('state.set', (_$: any, e: any, next: any) => {
    vals.set(`${e.plugin}.${e.key}`, e.value)
    if (e.key === 'isOn' || e.key === 'menuEntry') order.push(`${e.key}=${e.key === 'isOn' ? e.value : e.value.summary}`)
    return next(e)
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), ok))
  on('command.register', () => ok)
  on('ui.open', (_$: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.render', async ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return { store, files, toasts, order, opened, state: (k: string) => vals.get(k), setState: (k: string, v: unknown) => (vals.set(k, v), ver.set(k, (ver.get(k) ?? 0) + 1)) }
}

const run = ($: any, args: string) => $.command.run({ command: 'statusline', args })

test('default off: no status row, the hint is left alone', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { files } = engine(on)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(hint)
  expect(await ui.find({ type: 'Text', text: /ctx / })).toBeUndefined()
  expect(JSON.parse(files[SETTINGS]!).statusLine).toEqual(USER_LINE)
})

test('on then off: statusLine is backed up, removed, and restored', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { store, files } = engine(on)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  await run($, 'on')
  expect(JSON.parse(files[SETTINGS]!)).toEqual({ theme: 'x' })
  expect(JSON.parse(files[BAK]!).statusLine).toEqual(USER_LINE)
  expect(store.isOn).toBe(true)
  const ui = await $.ui.mount(hint)
  expect(await ui.find({ type: 'Text', text: /ctx / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()

  await run($, 'off')
  expect(JSON.parse(files[SETTINGS]!)).toEqual({ theme: 'x', statusLine: USER_LINE })
  expect(store.savedStatusLine).toBeUndefined()
  expect(await (await $.ui.mount(hint)).find({ type: 'Text', text: /ctx / })).toBeUndefined()
})

test('the mods button shows only while menu.present is true', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { setState } = engine(on, { files: { [SETTINGS]: '{}' } })
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  await run($, 'on')
  const bare = await $.ui.mount(hint)
  expect(await bare.find({ key: 'mods-open' })).toBeUndefined()
  await bare.unmount()
  setState('menu.present', true)
  expect(await (await $.ui.mount(hint)).find({ key: 'mods-open' })).toBeDefined()
})

test('menuEntry is written at start and on change', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { state } = engine(on, { files: { [SETTINGS]: '{}' } })
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  expect(state('statusline.menuEntry')).toEqual({ apiVersion: 1, title: 'Status line', summary: 'off', order: 1 })
  await run($, 'on')
  expect((state('statusline.menuEntry') as any).summary).toBe('on')
})

test('the page is drawn in the menu pane only when menu.panel is statusline', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { state, setState } = engine(on)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  setState('menu.panel', 'main')
  const closed = await $.ui.mount(menuPane('main'))
  expect(await closed.find({ key: 'status-on' })).toBeUndefined()
  await closed.unmount()
  setState('menu.panel', 'statusline')
  const ui = await $.ui.mount(menuPane('statusline'))
  expect(await ui.find({ key: 'mods-back' })).toBeDefined()
  await ui.press({ key: 'status-on' })
  expect(state('statusline.isOn')).toBe(true)
})

const setLive = (files: Record<string, string>, line: unknown) => {
  const cur = JSON.parse(files[SETTINGS]!)
  if (line === undefined) delete cur.statusLine
  else cur.statusLine = line
  files[SETTINGS] = JSON.stringify(cur)
}
const live = (files: Record<string, string>) => JSON.parse(files[SETTINGS]!).statusLine

test('on(A), user sets B, on again: B is saved and A is kept in prev.bak', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { store, files } = engine(on)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  await run($, 'on')
  const B = { type: 'command', command: 'echo b' }
  setLive(files, B)
  await run($, 'on')
  expect(live(files)).toBeUndefined()
  expect((store.savedStatusLine as any).statusLine).toEqual(B)
  expect(JSON.parse(files[`${SETTINGS}.statusline.prev.bak`]!).history.map((h: any) => h.statusLine)).toEqual([USER_LINE])
})

test('on(A), user sets B, off, on: B stays live, A is kept, nothing resurrects', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { store, files } = engine(on)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  await run($, 'on')
  const B = { type: 'command', command: 'echo b' }
  setLive(files, B)
  await run($, 'off')
  expect(live(files)).toEqual(B)
  expect(store.savedStatusLine).toBeUndefined()
  expect(JSON.parse(files[`${SETTINGS}.statusline.prev.bak`]!).history.map((h: any) => h.statusLine)).toEqual([USER_LINE])
  await run($, 'on')
  expect((store.savedStatusLine as any).statusLine).toEqual(B)
})

test('off with a live statusLine, user deletes it, off again: the old value does not come back', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { files } = engine(on)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  await run($, 'on')
  setLive(files, { type: 'command', command: 'echo b' })
  await run($, 'off')
  setLive(files, undefined)
  await run($, 'off')
  expect(live(files)).toBeUndefined()
})

test('persisted on with a statusLine back in settings.json: moved again at start', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { store, files } = engine(on, { store: { isOn: true } })
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  expect(live(files)).toBeUndefined()
  expect((store.savedStatusLine as any).statusLine).toEqual(USER_LINE)
})

test('A, B, C superseded in turn: prev.bak keeps both A and B; toast says where', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { files, toasts } = engine(on)
  const B = { type: 'command', command: 'echo b' }
  const C = { type: 'command', command: 'echo c' }
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  await run($, 'on')
  setLive(files, B)
  await run($, 'off') // A superseded by B
  await run($, 'on') // B saved
  setLive(files, C)
  await run($, 'on') // B superseded by C
  const history = JSON.parse(files[`${SETTINGS}.statusline.prev.bak`]!).history
  expect(history.map((h: any) => h.statusLine)).toEqual([USER_LINE, B])
  expect(history[0].at).toMatch(/^\d{4}-\d\d-\d\dT/)
  expect(toasts.some(t => t.includes('statusline.prev.bak') && t.includes('2 entries'))).toBe(true)
})

test('crash after isOn=false was stored: next start restores the saved statusLine', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { files } = engine(on, { store: { isOn: false, savedStatusLine: { statusLine: USER_LINE } }, files: { [SETTINGS]: '{"theme":"x"}' } })
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  expect(live(files)).toEqual(USER_LINE)
})

test('a failed move leaves the stored mode as it was', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { store, files, toasts } = engine(on, { files: { [SETTINGS]: '{not json' } })
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  const out = await run($, 'on')
  expect(out.text).toMatch(/could not be turned on/)
  expect(files[SETTINGS]).toBe('{not json')
  expect(files[BAK]).toBeUndefined()
  expect(store.savedStatusLine).toBeUndefined()
  expect(store.isOn).toBe(false)
  expect(toasts.length).toBe(0)
})

test('missing settings.json: on works, nothing to back up', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { files, store } = engine(on, { files: {} })
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  await run($, 'on')
  expect(store.isOn).toBe(true)
  expect(files[SETTINGS]).toBeUndefined()
  expect(files[BAK]).toBeUndefined()
})

test('on/on and off/off are no-ops for settings.json', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { files } = engine(on)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  await run($, 'off')
  expect(live(files)).toEqual(USER_LINE)
  await run($, 'on')
  const after = files[SETTINGS]
  await run($, 'on')
  expect(files[SETTINGS]).toBe(after)
  await run($, 'off')
  await run($, 'off')
  expect(live(files)).toEqual(USER_LINE)
})

test('/statusline with no argument opens the settings pane', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { opened } = engine(on)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  await run($, '')
  expect(opened).toEqual(['statusline-settings'])
})

test('the row with the menu absent: model, folder, branch, context, limit countdown', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on, { files: { [SETTINGS]: '{}' } })
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  await run($, 'on')
  const ui = await $.ui.mount(hint)
  const row = (await ui.find({ type: 'Text', text: /ctx/ })) as any
  expect(row.text).toMatch(/^Opus 5\.5 · proj · main {2}│ {2}ctx .*41% 82k\/200k {2}│ {2}5h .*30% \(resets \d+[smhd]/)
  expect(await ui.find({ key: 'mods-open' })).toBeUndefined()
})

test('on with no snapshot yet: the hint row and the mods button are still drawn', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { setState } = engine(on, { store: { isOn: true }, files: { [SETTINGS]: '{}' }, noUsage: true })
  setState('menu.present', true)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...hint, props: { hint: 'esc to interrupt\n·', columns: 140 } })
  expect(await ui.find({ type: 'Text', text: 'esc to interrupt' })).toBeDefined()
  expect(await ui.find({ key: 'mods-open' })).toBeDefined()
})

test('the menuEntry and the mode flip in an order that keeps summary on <=> our footer', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { order: seen } = engine(on, { files: { [SETTINGS]: '{}' } })
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  seen.length = 0
  await run($, 'on')
  await run($, 'off')
  expect(seen).toEqual(['isOn=true', 'menuEntry=on', 'menuEntry=off', 'isOn=false'])
})

// context-threshold toasts (the check is fire-and-forget: let it settle)
const ctx = (t: string[]) => t.filter(x => x.startsWith('Context at'))
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const begin = async ($: any) => { await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true }); await settle() }
const done = async ($: any) => { const r = await $.turn.complete({ turnId: 't', answer: '', reason: 'answer' } as any).catch(() => undefined); await settle(); return r }

test('context toasts: 59% none, 60% one, 80% one more, no repeats, new session resets (line off)', async ($, on) => {
  mock.clock(on, { now: 0 })
  let pct = 59
  on('turn.complete', () => ({ text: 'stub' }))
  const { toasts, store } = engine(on, { pct: () => pct })
  await begin($)
  expect(store.isOn).toBeUndefined()
  expect(await done($)).toEqual({ text: 'stub' })
  expect(ctx(toasts)).toEqual([])
  pct = 60.4
  await done($)
  await done($)
  expect(ctx(toasts)).toEqual(['Context at 60% - consider /compact at the next pause'])
  pct = 85
  await done($)
  await done($)
  expect(ctx(toasts)).toEqual(['Context at 60% - consider /compact at the next pause', 'Context at 85% - time to /compact'])
  pct = 61
  await begin($)
  expect(ctx(toasts)[2]).toBe('Context at 61% - consider /compact at the next pause')
  expect(ctx(toasts)).toHaveLength(3)
})

test('context toasts: first reading at 85% shows only the 80 message; 60 is then warned', async ($, on) => {
  mock.clock(on, { now: 0 })
  let pct = 85
  on('turn.complete', () => ({ text: '' }))
  const { toasts } = engine(on, { pct: () => pct })
  await begin($)
  pct = 90
  await done($)
  expect(ctx(toasts)).toEqual(['Context at 85% - time to /compact'])
})

test('context toasts: null percent gives no toast', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('turn.complete', () => ({ text: '' }))
  const { toasts } = engine(on, { pct: () => null as any })
  await begin($)
  await done($)
  expect(ctx(toasts)).toEqual([])
})

test('context toasts: usage throwing breaks nothing; agent.spawn passes through and can be the first trigger', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('turn.complete', () => ({ text: '' }))
  let seen = 0
  on('agent.spawn', (_$: any, e: any) => (seen++, { model: 'm', agentId: 'sub-1' }))
  const bad = engine(on, { noUsage: true })
  await begin($)
  await done($)
  const r = await $.agent.spawn({ prompt: 'x', description: 'd' })
  await settle()
  expect(seen).toBe(1)
  expect(r.agentId).toBe('sub-1')
  expect(ctx(bad.toasts)).toEqual([])
})

test('context toasts: agent.spawn as first trigger at 65% gives exactly one toast', async ($, on) => {
  mock.clock(on, { now: 0 })
  let pct = 50
  on('agent.spawn', () => ({ model: 'm', agentId: 'sub-1' }))
  const { toasts } = engine(on, { pct: () => pct })
  await begin($)
  pct = 65
  await $.agent.spawn({ prompt: 'x', description: 'd' })
  await settle()
  await $.agent.spawn({ prompt: 'x', description: 'd' })
  await settle()
  expect(ctx(toasts)).toEqual(['Context at 65% - consider /compact at the next pause'])
})
