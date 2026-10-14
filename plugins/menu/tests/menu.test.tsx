import { expect, test } from 'claude-code/testing'

const ok = { value: undefined } as any
const pane = { plugin: 'menu', surface: 'terminal', component: 'Pane', requestId: 'mods-menu', props: { bodyColumns: 60, scroll: { bodyRows: 10 }, view: {} } } as any
const hint = { plugin: 'menu', surface: 'terminal', component: 'PromptHint', props: { hint: 'esc to interrupt' }, viewport: { columns: 140, rows: 40 } } as any

const entry = (title: string, summary: string, order: number, apiVersion = 1) => ({ apiVersion, title, summary, order })

// what the engine would answer beneath the plugin; `foreign` plays the member mods' state
function engine(on: any, foreign: Record<string, unknown> = {}) {
  const vals = new Map<string, unknown>(Object.entries(foreign))
  const opened: string[] = []
  const toasts: string[] = []
  const closed: string[] = []
  const commands: unknown[] = []
  on('state.get', (_$: any, e: any, next: any) => (e.plugin === 'menu' ? next(e) : { value: { value: vals.get(`${e.plugin}.${e.key}`), version: 0 } }))
  on('state.set', (_$: any, e: any, next: any) => (vals.set(`${e.plugin}.${e.key}`, e.value), next(e)))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_$: any, e: any) => (commands.push(e.name), ok))
  on('ui.open', (_$: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), ok))
  on('ui.close', (_$: any, e: any) => (closed.push(e.id), undefined))
  on('ui.render', async ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return { vals, toasts, opened, closed, commands, state: (k: string) => vals.get(k), set: (k: string, v: unknown) => vals.set(k, v) }
}

const start = ($: any) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
const mods = ($: any, args = '') => $.command.run({ command: 'mods', args })
test('session.start sets menu.present and registers /mods', async ($, on) => {
  const { state, commands } = engine(on)
  await start($)
  expect(state('menu.present')).toBe(true)
  expect(state('menu.panel')).toBe('main')
  expect(commands).toContain('mods')
})

test('no member installed: a note and how to install', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: /No mods installed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /plugin install/ })).toBeDefined()
  expect(await ui.find({ key: 'open-mode' })).toBeUndefined()
})

test('one member present: one row with its summary', async ($, on) => {
  engine(on, { 'mode.menuEntry': entry('Mode', 'Opus 5.5 · effort high', 3) })
  await start($)
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ key: 'open-mode' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /effort high/ })).toBeDefined()
  expect(await ui.find({ key: 'open-statusline' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /No mods installed/ })).toBeUndefined()
})

test('all present, sorted by order; wrong apiVersion skipped', async ($, on) => {
  engine(on, {
    'mode.menuEntry': entry('Mode', 'm', 3),
    'statusline.menuEntry': entry('Status line', 'off', 1),
    'cleanscreen.menuEntry': entry('Clean screen', 'off', 2, 2),
  })
  await start($)
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ key: 'open-cleanscreen' })).toBeUndefined()
  const a = await ui.find({ key: 'open-statusline' })
  const b = await ui.find({ key: 'open-mode' })
  expect(a && b).toBeDefined()
  expect(a.props.hotkey).toBe('1')
  expect(b.props.hotkey).toBe('2')
})

test('three members keep the order 1, 2, 3', async ($, on) => {
  engine(on, {
    'mode.menuEntry': entry('Mode', 'm', 3),
    'cleanscreen.menuEntry': entry('Clean screen', 'off', 2),
    'statusline.menuEntry': entry('Status line', 'off', 1),
  })
  await start($)
  const ui = await $.ui.mount(pane)
  expect((await ui.find({ key: 'open-cleanscreen' })).props.hotkey).toBe('2')
  expect((await ui.find({ key: 'open-mode' })).props.hotkey).toBe('3')
})

test('pressing a row sets menu.panel; the main page is not drawn on a member panel', async ($, on) => {
  const { state } = engine(on, { 'mode.menuEntry': entry('Mode', 'm', 3) })
  await start($)
  const ui = await $.ui.mount(pane)
  await ui.press({ key: 'open-mode' })
  expect(state('menu.panel')).toBe('mode')
  await ui.unmount()
  const member = await $.ui.mount(pane)
  expect(await member.find({ key: 'open-mode' })).toBeUndefined()
})

test('footer: own button when the status line is off or absent, none when it is on', async ($, on) => {
  const { set } = engine(on)
  await start($)
  const absent = await $.ui.mount(hint)
  expect(await absent.find({ type: 'Text', text: /esc to interrupt/ })).toBeDefined()
  await absent.unmount()
  set('statusline.menuEntry', entry('Status line', 'off', 1))
  const off = await $.ui.mount(hint)
  expect(await off.find({ type: 'Text', text: /esc to interrupt/ })).toBeDefined()
  await off.unmount()
  set('statusline.menuEntry', entry('Status line', 'on', 1))
  const on_ = await $.ui.mount(hint)
  expect(await on_.find({ type: 'Text', text: /esc to interrupt/ })).toBeUndefined() // the status line draws the row
})

test('the footer button opens the pane', async ($, on) => {
  const { opened } = engine(on)
  await start($)
  const ui = await $.ui.mount(hint)
  await ui.press({ key: 'mods-open' })
  expect(opened).toEqual(['mods-menu'])
})

test('/mods opens on main; /mods mode opens on the mode page', async ($, on) => {
  const { opened, state } = engine(on, { 'mode.menuEntry': entry('Mode', 'm', 3) })
  await start($)
  await mods($)
  expect(opened).toEqual(['mods-menu'])
  expect(state('menu.panel')).toBe('main')
  await mods($, 'mode')
  expect(state('menu.panel')).toBe('mode')
  expect(opened.length).toBe(1)
})

test('/mods mode when closed opens straight on mode', async ($, on) => {
  const { state } = engine(on, { 'mode.menuEntry': entry('Mode', 'm', 3) })
  await start($)
  await mods($, 'mode')
  expect(state('menu.panel')).toBe('mode')
})

test('/mods <name> for an absent member opens main with a toast', async ($, on) => {
  const { state, toasts } = engine(on, { 'mode.menuEntry': entry('Mode', 'm', 3) })
  await start($)
  await mods($, 'statusline')
  expect(state('menu.panel')).toBe('main')
  expect(toasts).toEqual(['statusline is not installed'])
  await mods($, 'mode')
  expect(state('menu.panel')).toBe('mode')
})

test('a member panel whose entry disappeared draws main', async ($, on) => {
  const { set } = engine(on, { 'mode.menuEntry': entry('Mode', 'm', 3) })
  await start($)
  set('menu.panel', 'cleanscreen')
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ key: 'open-mode' })).toBeDefined()
})

test('four members keep the order 1 to 4, permissions last', async ($, on) => {
  engine(on, {
    'permissions.menuEntry': entry('Permissions', 'new sessions: ask', 4),
    'mode.menuEntry': entry('Mode', 'm', 3),
    'cleanscreen.menuEntry': entry('Clean screen', 'off', 2),
    'statusline.menuEntry': entry('Status line', 'off', 1),
  })
  await start($)
  const ui = await $.ui.mount(pane)
  expect((await ui.find({ key: 'open-statusline' })).props.hotkey).toBe('1')
  expect((await ui.find({ key: 'open-cleanscreen' })).props.hotkey).toBe('2')
  expect((await ui.find({ key: 'open-mode' })).props.hotkey).toBe('3')
  expect((await ui.find({ key: 'open-permissions' })).props.hotkey).toBe('4')
})

test('/mods permissions opens its page; absent it opens main with a toast', async ($, on) => {
  const { state, toasts, set } = engine(on)
  await start($)
  await mods($, 'permissions')
  expect(state('menu.panel')).toBe('main')
  expect(toasts).toEqual(['permissions is not installed'])
  set('permissions.menuEntry', entry('Permissions', 'new sessions: ask', 4))
  await mods($, 'permissions')
  expect(state('menu.panel')).toBe('permissions')
})
