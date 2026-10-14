import { expect, mock, test } from 'claude-code/testing'

const ok = { value: undefined } as any
const SETTINGS = '/cfg/settings.json'
const BAK = `${SETTINGS}.permissions.bak`
const PREV = `${SETTINGS}.permissions.prev.bak`
const ORIGINAL = { theme: 'x', permissions: { defaultMode: 'acceptEdits', allow: ['Bash(ls)'] }, statusLine: { type: 'command', command: 'echo mine' } }

const pane = (requestId: string) => ({ plugin: 'permissions', surface: 'terminal', component: 'Pane', requestId, props: { bodyColumns: 60, scroll: { bodyRows: 12 }, view: {} } }) as any
const menuPane = pane('mods-menu')
const ownPane = pane('permissions-settings')

// what the engine would answer beneath the plugin
function engine(on: any, opts: { files?: Record<string, string> } = {}) {
  const files = opts.files ?? { [SETTINGS]: JSON.stringify(ORIGINAL) }
  const toasts: string[] = []
  const opened: string[] = []
  const commands: string[] = []
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('fs.exists', (_$: any, e: any) => ({ value: e.path in files }))
  on('fs.read', (_$: any, e: any) => ({ value: files[e.path] }))
  on('fs.write', (_$: any, e: any) => ((files[e.path] = e.content ?? e.text ?? e.data), ok))
  on('settings.read', () => {
    try {
      return { value: JSON.parse(files[SETTINGS] ?? '{}') }
    } catch {
      return Promise.reject(new Error('invalid settings'))
    }
  })
  const vals = new Map<string, unknown>()
  const ver = new Map<string, number>()
  on('state.get', (_$: any, e: any, next: any) => {
    const k = `${e.plugin}.${e.key}`
    return e.plugin === 'menu' ? { value: { value: vals.get(k), version: ver.get(k) ?? 0 } } : next(e)
  })
  on('state.set', (_$: any, e: any, next: any) => (vals.set(`${e.plugin}.${e.key}`, e.value), next(e)))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), ok))
  on('command.register', (_$: any, e: any) => (commands.push(e.name), ok))
  on('ui.open', (_$: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.render', async ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return { files, toasts, opened, commands, state: (k: string) => vals.get(k), setState: (k: string, v: unknown) => (vals.set(k, v), ver.set(k, (ver.get(k) ?? 0) + 1)) }
}

const start = ($: any) => $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
const run = ($: any, args: string) => $.command.run({ command: 'permmode', args })
const written = (files: Record<string, string>) => JSON.parse(files[SETTINGS]!)

test('install writes nothing; the entry and the command are published', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { files, commands, state } = engine(on)
  await start($)
  expect(files).toEqual({ [SETTINGS]: JSON.stringify(ORIGINAL) })
  expect(commands).toEqual(['permmode'])
  expect(state('permissions.menuEntry')).toEqual({ apiVersion: 1, title: 'Permissions', summary: 'new sessions: accept edits', order: 4 })
})

test('page lists the modes and marks the current default; running mode is unknown', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  await start($)
  const ui = await $.ui.mount(ownPane)
  // each mode key carries its own exact label: a swap of default and dontAsk shows up here
  const labels = { default: 'ask', plan: 'plan', acceptEdits: 'accept edits', auto: 'auto', dontAsk: "don't ask", bypassPermissions: 'bypass permissions' }
  for (const [key, label] of Object.entries(labels)) {
    const row = await ui.find({ type: 'Button', key: `default-mode-${key}` })
    expect(row.text).toBe(`${key === 'acceptEdits' ? '●' : '○'} ${label}`)
  }
  expect(await ui.find({ type: 'Button', text: /^● accept edits/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^○ plan/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /unknown/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'mods-back' })).toBeUndefined()
})

test('picking a mode writes only permissions.defaultMode and creates the backup once', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { files, toasts } = engine(on)
  await start($)
  const ui = await $.ui.mount(ownPane)
  await ui.press({ key: 'default-mode-plan' })
  const expected = { ...ORIGINAL, permissions: { ...ORIGINAL.permissions, defaultMode: 'plan' } }
  expect(written(files)).toEqual(expected)
  expect(JSON.parse(files[BAK]!)).toEqual(ORIGINAL)
  expect(JSON.parse(files[PREV]!).history.map((h: any) => h.defaultMode)).toEqual(['acceptEdits'])
  expect(toasts).toContain('New sessions start in plan mode')
  await ui.press({ key: 'default-mode-auto' })
  expect(written(files).permissions.defaultMode).toBe('auto')
  expect(JSON.parse(files[BAK]!)).toEqual(ORIGINAL) // the first original stays
  expect(JSON.parse(files[PREV]!).history.map((h: any) => h.defaultMode)).toEqual(['acceptEdits', 'plan'])
})

test('a missing settings.json is created with only the mode, no backup', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { files } = engine(on, { files: {} })
  await start($)
  await run($, 'plan')
  expect(written(files)).toEqual({ permissions: { defaultMode: 'plan' } })
  expect(files[BAK]).toBeUndefined()
})

test('invalid settings JSON aborts without writing and toasts', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { files, toasts } = engine(on, { files: { [SETTINGS]: '{ not json' } })
  await start($)
  const ui = await $.ui.mount(ownPane)
  await ui.press({ key: 'default-mode-plan' })
  expect(files).toEqual({ [SETTINGS]: '{ not json' })
  expect(toasts).toEqual(['Could not set the default mode: settings.json is not valid JSON; nothing was written.'])
})

test('a non-object permissions key aborts without writing', async ($, on) => {
  mock.clock(on, { now: 0 })
  const text = JSON.stringify({ permissions: ['x'] })
  const { files } = engine(on, { files: { [SETTINGS]: text } })
  await start($)
  const result = await run($, 'plan')
  expect(files).toEqual({ [SETTINGS]: text })
  expect(result.text).toBe('The default mode could not be changed: settings.json "permissions" is not an object; nothing was written.')
})

test('/permmode plan sets it; no arg opens the pane; unknown arg gives usage', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { files, opened } = engine(on)
  await start($)
  expect((await run($, 'plan')).text).toBe('New sessions start in plan mode.')
  expect(written(files).permissions.defaultMode).toBe('plan')
  const before = files[SETTINGS]
  const bad = await run($, 'yolo')
  expect(bad.text).toMatch(/^Usage: \/permmode \[default\|plan\|acceptEdits\|auto\|dontAsk\|bypassPermissions\]/)
  expect(files[SETTINGS]).toBe(before)
  await run($, '')
  expect(opened).toEqual(['permissions-settings'])
})

test('menu member: drawn only when menu.panel is permissions', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { setState } = engine(on)
  await start($)
  setState('menu.panel', 'main')
  const closed = await $.ui.mount(menuPane)
  expect(await closed.find({ type: 'Text', text: /Permissions/ })).toBeUndefined()
  await closed.unmount()
  setState('menu.panel', 'permissions')
  const ui = await $.ui.mount(menuPane)
  expect(await ui.find({ type: 'Text', text: /Permissions/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'mods-back' })).toBeDefined()
})

test('bypass warning shows when bypassPermissions is the default', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  await start($)
  const ui = await $.ui.mount(ownPane)
  expect(await ui.find({ type: 'Text', text: /Bypass skips every permission check/ })).toBeUndefined()
  await ui.press({ key: 'default-mode-bypassPermissions' })
  await ui.unmount()
  const again = await $.ui.mount(ownPane)
  expect(await again.find({ type: 'Text', text: /Bypass skips every permission check/ })).toBeDefined()
})

test('/permmode bypassPermissions writes nothing and points to the pane; the pane press sets it with the warning', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { files, toasts } = engine(on)
  await start($)
  const before = { ...files }
  const result = await run($, 'bypassPermissions')
  expect(result.text).toMatch(/only be picked in the pane/)
  expect(files).toEqual(before)
  const ui = await $.ui.mount(ownPane)
  await ui.press({ key: 'default-mode-bypassPermissions' })
  expect(written(files).permissions.defaultMode).toBe('bypassPermissions')
  expect(toasts.some(t => t.includes('bypass permissions') && t.includes('Bypass skips every permission check'))).toBe(true)
})

test('re-picking the current default writes nothing, still answers', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { files, toasts } = engine(on)
  await start($)
  const before = { ...files }
  const result = await run($, 'acceptEdits')
  expect(result.text).toBe('New sessions start in accept edits mode.')
  expect(files).toEqual(before)
  expect(toasts).toContain('New sessions start in accept edits mode')
})

test('the marker follows the file on every draw, and the override note is shown', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { files } = engine(on)
  await start($)
  const first = await $.ui.mount(ownPane)
  expect(await first.find({ type: 'Button', text: /^● accept edits/ })).toBeDefined()
  expect(await first.find({ type: 'Text', text: /Project or local settings can override/ })).toBeDefined()
  await first.unmount()
  files[SETTINGS] = JSON.stringify({ permissions: { defaultMode: 'dontAsk' } }) // edited outside the mod
  const again = await $.ui.mount(ownPane)
  expect(await again.find({ type: 'Button', text: /^● don't ask/ })).toBeDefined()
  expect(await again.find({ type: 'Button', text: /^● accept edits/ })).toBeUndefined()
})

test('an absent defaultMode counts as default: picking default writes nothing', async ($, on) => {
  mock.clock(on, { now: 0 })
  const text = JSON.stringify({ theme: 'x' })
  const { files } = engine(on, { files: { [SETTINGS]: text } })
  await start($)
  const ui = await $.ui.mount(ownPane)
  await ui.press({ key: 'default-mode-default' })
  expect(files).toEqual({ [SETTINGS]: text })
  expect((await run($, 'default')).text).toBe('New sessions start in ask mode.')
  expect(files).toEqual({ [SETTINGS]: text })
})
