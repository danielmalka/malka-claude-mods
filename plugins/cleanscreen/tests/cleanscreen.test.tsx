import { expect, mock, test } from 'claude-code/testing'

import { addStep, contextFor, parseInput, PROMPT, todoSteps, updateSteps } from '../hooks/clean'

const ok = { value: undefined } as any
const TOOL = 'mcp__cleanscreen__cleanscreen_progress'
const STEPS = [
  { text: 'Read files', status: 'completed' },
  { text: 'Write code', status: 'in_progress' },
]

const surface = (component: string, extra: object = {}, props: object = {}) =>
  ({ plugin: 'cleanscreen', surface: 'terminal', component, props: { bodyColumns: 80, ...props }, viewport: { columns: 100, rows: 40 }, ...extra }) as any
const menuPane = { plugin: 'cleanscreen', surface: 'terminal', component: 'Pane', requestId: 'mods-menu', props: { bodyColumns: 60, scroll: { bodyRows: 10 }, view: {} } } as any

const throwing = { calls: 0, asked: 0 }

// what the engine would answer beneath the plugin
function engine(on: any, opts: { store?: Record<string, unknown> } = {}) {
  const store = opts.store ?? {}
  const opened: string[] = []
  const registered: string[] = []
  const toasts: string[] = []
  const contexts: unknown[] = []
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: any, e: any) => ((store[e.key] = e.value), ok))
  const vals = new Map<string, unknown>()
  const ver = new Map<string, number>()
  on('state.get', (_$: any, e: any, next: any) => {
    const k = `${e.plugin}.${e.key}`
    return e.plugin === 'menu' ? { value: { value: vals.get(k), version: ver.get(k) ?? 0 } } : next(e)
  })
  on('state.set', (_$: any, e: any, next: any) => (vals.set(`${e.plugin}.${e.key}`, e.value), next(e)))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), ok))
  on('command.register', () => ok)
  on('tool.register', (_$: any, e: any) => (registered.push(e.name), { value: { tool: `mcp__cleanscreen__${e.name}` } }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.open', (_$: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('prompt.submit', (_$: any, e: any) => (contexts.push(e.context), { text: e.text }))
  on('ui.render', async ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    if (e.component === 'AbovePrompt') throwing.asked++
    if (e.component === 'AbovePrompt' && e.props.__throw) {
      throwing.calls++
      throw new Error('beneath failed')
    }
    if (e.component === 'AbovePrompt') return <Text key="beneath">from beneath</Text>
    return ['ToolUse', 'ToolResult', 'ToolGroup'].includes(e.component) ? <Text>Bash ls</Text> : <Box />
  })
  return { store, opened, registered, toasts, contexts, state: (k: string) => vals.get(k), setState: (k: string, v: unknown) => (vals.set(k, v), ver.set(k, (ver.get(k) ?? 0) + 1)) }
}

const start = ($: any) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
const run = ($: any, args: string) => $.command.run({ command: 'cleanscreen', args })
const progress = ($: any) => $.tool.call({ tool: TOOL, title: 'Ship it', steps: STEPS })

test('default off: nothing registered, no band, tool rows untouched', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { registered, store } = engine(on)
  await start($)
  expect(registered).toEqual([])
  expect(store.isOn).toBeUndefined()
  expect(await (await $.ui.mount(surface('ToolUse'))).find({ type: 'Text', text: /Bash ls/ })).toBeDefined()
  expect(await (await $.ui.mount(surface('AbovePrompt'))).find({ type: 'Text', text: /%/ })).toBeUndefined()
})

test('on then off: stored, tool exposed only when on, tool rows hidden', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { store, registered } = engine(on)
  await start($)
  await run($, 'on')
  expect(store.isOn).toBe(true)
  expect(registered).toEqual(['cleanscreen_progress'])
  expect(await (await $.ui.mount(surface('ToolUse'))).find({ type: 'Text', text: /Bash ls/ })).toBeUndefined()
  await run($, 'off')
  expect(store.isOn).toBe(false)
  expect(await (await $.ui.mount(surface('ToolUse'))).find({ type: 'Text', text: /Bash ls/ })).toBeDefined()
})

test('a stored on is honoured at session start', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { registered, state } = engine(on, { store: { isOn: true, theme: 'green' } })
  await start($)
  expect(registered).toEqual(['cleanscreen_progress'])
  expect((state('cleanscreen.menuEntry') as any).summary).toBe('on · green band')
})

test('theme: valid names stick, unknown ones are refused', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { store } = engine(on)
  await start($)
  expect((await run($, 'theme rainbow')).text).toMatch(/rainbow/)
  expect(store.theme).toBe('rainbow')
  expect((await run($, 'theme neon')).text).toMatch(/Themes:/)
  expect(store.theme).toBe('rainbow')
})

test('custom color: only #rrggbb is accepted', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { store } = engine(on)
  await start($)
  expect((await run($, 'color bar red')).text).toMatch(/not a hex color/)
  expect(store.custom).toBeUndefined()
  await run($, 'color bar #112233')
  expect((store.custom as any).bar).toBe('#112233')
  expect((await run($, 'color glow #112233')).text).toMatch(/Usage/)
})

test('a progress call draws the band; off it only answers', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  await start($)
  expect((await progress($)).result).toMatch(/off/)
  expect(await (await $.ui.mount(surface('AbovePrompt'))).find({ type: 'Text', text: /Write code/ })).toBeUndefined()
  await run($, 'on')
  expect((await progress($)).result).toMatch(/1 of 2 steps done \(50%\)/)
  const band = await $.ui.mount(surface('AbovePrompt'))
  expect(await band.find({ type: 'Text', text: /Ship it/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /Write code/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /50%/ })).toBeDefined()
  await run($, 'off')
  expect(await (await $.ui.mount(surface('AbovePrompt'))).find({ type: 'Text', text: /Write code/ })).toBeUndefined()
})

test('the band keeps what another AbovePrompt hook draws beneath it', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  await start($)
  await run($, 'on')
  await progress($)
  const ui = await $.ui.mount(surface('AbovePrompt'))
  expect(await ui.find({ type: 'Text', text: /Write code/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'from beneath' })).toBeDefined()
})

test('a throwing hook beneath is asked exactly once and its error is not swallowed', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  await start($)
  await run($, 'on')
  await progress($)
  throwing.calls = 0
  await expect($.ui.mount(surface('AbovePrompt', {}, { __throw: true }))).rejects.toThrow()
  expect(throwing.calls).toBe(1)
})

test('the hook beneath is asked exactly once: band on, band off, no task, survey', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  await start($)
  let last: any
  const asked = async (props: object = {}) => {
    await last?.unmount() // an older mount would be redrawn by later state changes and be counted
    throwing.asked = 0
    const ui = await $.ui.mount(surface('AbovePrompt', {}, props))
    last = ui
    return { n: throwing.asked, ui }
  }
  // off: pass-through
  let r = await asked()
  expect(r.n).toBe(1)
  expect(await r.ui.find({ type: 'Text', text: 'from beneath' })).toBeDefined()
  await run($, 'on')
  // on, no task yet
  r = await asked()
  expect(r.n).toBe(1)
  expect(await r.ui.find({ type: 'Text', text: /Write code/ })).toBeUndefined()
  await progress($)
  // on with a task: the band and the content beneath, one question
  r = await asked()
  expect(r.n).toBe(1)
  expect(await r.ui.find({ type: 'Text', text: 'from beneath' })).toBeDefined()
  expect(await r.ui.find({ type: 'Text', text: /Write code/ })).toBeDefined()
  // a survey holds the band: ours yields, still one question
  r = await asked({ hasSurvey: true })
  expect(r.n).toBe(1)
  expect(await r.ui.find({ type: 'Text', text: /Write code/ })).toBeUndefined()
  expect(await r.ui.find({ type: 'Text', text: 'from beneath' })).toBeDefined()
})

test('menuEntry: apiVersion 1, off and on', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { state } = engine(on)
  await start($)
  expect(state('cleanscreen.menuEntry')).toEqual({ apiVersion: 1, title: 'Clean screen', summary: 'off', order: 2 })
  await run($, 'on')
  expect(state('cleanscreen.menuEntry')).toEqual({ apiVersion: 1, title: 'Clean screen', summary: 'on · blue band', order: 2 })
})

test('the page is drawn in the menu pane only when menu.panel is cleanscreen', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { state, setState } = engine(on)
  await start($)
  setState('menu.panel', 'main')
  const closed = await $.ui.mount(menuPane)
  expect(await closed.find({ key: 'cs-on' })).toBeUndefined()
  await closed.unmount()
  setState('menu.panel', 'cleanscreen')
  const ui = await $.ui.mount(menuPane)
  expect(await ui.find({ key: 'mods-back' })).toBeDefined()
  await ui.press({ key: 'cs-on' })
  expect(state('cleanscreen.isOn')).toBe(true)
  await ui.press({ key: 'cs-theme-green' })
  expect(state('cleanscreen.theme')).toBe('green')
})

test('no argument opens the own pane, which works without a menu', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { opened } = engine(on)
  await start($)
  expect((await run($, '')).text).toMatch(/settings are open/)
  expect(opened).toEqual(['cleanscreen-settings'])
  const ui = await $.ui.mount({ ...menuPane, requestId: 'cleanscreen-settings' })
  expect(await ui.find({ key: 'cs-on' })).toBeDefined()
  expect(await ui.find({ key: 'mods-back' })).toBeUndefined()
})

test('errored or interrupted tool rows stay visible while on; normal ones are hidden', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  await start($)
  await run($, 'on')
  const seen = async (component: string, props: object) => (await (await $.ui.mount(surface(component, {}, props))).find({ type: 'Text', text: /Bash ls/ })) !== undefined
  expect(await seen('ToolUse', { isErrored: false, isInterrupted: false })).toBe(false)
  expect(await seen('ToolUse', { isErrored: true, isInterrupted: false })).toBe(true)
  expect(await seen('ToolUse', { isErrored: false, isInterrupted: true })).toBe(true)
})

// the test kit cannot raise turn.abort; turn.complete shares the same finishTask path
test('the turn ending finishes the band', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { state } = engine(on)
  await start($)
  await run($, 'on')
  await progress($)
  expect((state('cleanscreen.task') as any).doneAt).toBeNull()
  await $.turn.complete({ reason: 'aborted', answer: '', durationMs: 1, isAborted: true, turnId: 't1' } as any)
  expect((state('cleanscreen.task') as any).doneAt).not.toBeNull()
})

test('contextFor: composer prompts only, never slash, empty, other origins, or off', () => {
  expect(contextFor('composer', 'fix it', true)).toEqual([PROMPT])
  expect(contextFor('composer', 'fix it', false)).toEqual([])
  expect(contextFor('composer', '/clear', true)).toEqual([])
  expect(contextFor('composer', '   ', true)).toEqual([])
  expect(contextFor('task-notification', 'fix it', true)).toEqual([])
  expect(contextFor('bridge', 'fix it', true)).toEqual([PROMPT])
  expect(contextFor('plugin', 'fix it', true)).toEqual([])
  expect(contextFor(undefined, 'fix it', true)).toEqual([])
})

test('parseInput sanitizes what the model sends', () => {
  expect(parseInput(null)).toEqual({ title: '', steps: [] })
  expect(parseInput('x')).toEqual({ title: '', steps: [] })
  const long = 'a'.repeat(300)
  const r = parseInput({ title: ' T\u001b[31m\u2028 ', steps: [{ text: `\u0007hi${long}`, status: 'weird' }, { text: '  ' }, 5, null] })
  expect(r.title).toBe('T[31m')
  expect(r.steps).toHaveLength(1)
  expect(r.steps[0]!.text).toHaveLength(200)
  expect(r.steps[0]!.text.startsWith('hi')).toBe(true)
  expect(r.steps[0]!.status).toBe('pending')
  const many = parseInput({ steps: Array.from({ length: 80 }, (_, i) => ({ text: `s${i}`, status: 'completed' })) })
  expect(many.steps).toHaveLength(50)
})

test('Todo and Task paths drop empty steps', () => {
  expect(todoSteps([{ content: ' ', status: 'pending' }, { content: 'ok', status: 'pending' }]).map(s => s.text)).toEqual(['ok'])
  expect(addStep([], '1', '  ')).toEqual([])
  const steps = addStep([], '1', 'a')
  expect(updateSteps(steps, { taskId: '1', subject: '\u0007' })).toEqual([])
})

test('ToolResult and ToolGroup: errored visible while on, normal hidden', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  await start($)
  await run($, 'on')
  const seen = async (component: string, props: object) => (await (await $.ui.mount(surface(component, {}, props))).find({ type: 'Text', text: /Bash ls/ })) !== undefined
  expect(await seen('ToolResult', { isErrored: false })).toBe(false)
  expect(await seen('ToolResult', { isErrored: true })).toBe(true)
  expect(await seen('ToolGroup', { calls: [{ isErrored: false, isInterrupted: false }] })).toBe(false)
  expect(await seen('ToolGroup', { calls: [{ isErrored: false }, { isErrored: true }] })).toBe(true)
})

test('a progress call after the band is done starts a fresh task', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { state } = engine(on)
  await start($)
  await run($, 'on')
  await progress($)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1' } as any)
  expect((state('cleanscreen.task') as any).doneAt).not.toBeNull()
  await progress($)
  expect((state('cleanscreen.task') as any).doneAt).toBeNull()
})
