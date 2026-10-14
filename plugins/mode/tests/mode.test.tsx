import { expect, mock, test } from 'claude-code/testing'

const ok = { value: undefined } as any

const menuPane = { plugin: 'mode', surface: 'terminal', component: 'Pane', requestId: 'mods-menu', props: { bodyColumns: 60, scroll: { bodyRows: 10 }, view: {} } } as any
const ownPane = { ...menuPane, requestId: 'mode-settings' }

// what the engine would answer beneath the plugin
function engine(on: any, opts: { store?: Record<string, unknown>; noConfig?: boolean; throwStore?: boolean; throwRouter?: boolean } = {}) {
  const store = opts.store ?? {}
  const toasts: string[] = []
  const opened: string[] = []
  const commands: { command: string; args: string }[] = []
  const configSets: { key: string; value: unknown }[] = []
  const steps: any[] = []
  let model = 'claude-opus-5-5'
  on('env.get', () => ({ value: undefined }))
  on('store.get', (_$: any, e: any) => {
    if (opts.throwStore) throw new Error('store down')
    return { value: store[e.key] }
  })
  on('store.set', (_$: any, e: any) => ((store[e.key] = e.value), ok))
  on('store.delete', (_$: any, e: any) => (delete store[e.key], ok))
  on('session.model', () => ({ value: model }))
  on('command.run', (_$: any, e: any) => {
    commands.push({ command: e.command, args: e.args })
    if (e.command === 'model') model = e.args === 'sonnet' ? 'claude-sonnet-4-6' : model
    return { text: '' }
  })
  on('config.list', () => ({ value: opts.noConfig ? [] : [{ key: 'effort', value: 'medium', options: ['low', 'medium', 'high', 'xhigh', 'max'] }] }))
  on('config.set', (_$: any, e: any) => (configSets.push(e), { value: e.value }))
  on('settings.read', () => ({ value: {} }))
  const vals = new Map<string, unknown>()
  const ver = new Map<string, number>()
  on('state.get', (_$: any, e: any, next: any) => {
    if (opts.throwRouter && e.plugin === 'decision-router') throw new Error('no such plugin')
    const k = `${e.plugin}.${e.key}`
    return e.plugin === 'menu' || e.plugin === 'decision-router' ? { value: { value: vals.get(k), version: ver.get(k) ?? 0 } } : next(e)
  })
  on('state.set', (_$: any, e: any, next: any) => (vals.set(`${e.plugin}.${e.key}`, e.value), next(e)))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), ok))
  on('command.register', () => ok)
  on('ui.open', (_$: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('turn.step', async function* (_$: any, e: any) {
    steps.push(e)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as any
  })
  on('ui.render', async ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return { store, toasts, opened, commands, configSets, steps, state: (k: string) => vals.get(k), setState: (k: string, v: unknown) => (vals.set(k, v), ver.set(k, (ver.get(k) ?? 0) + 1)) }
}

const start = ($: any) => $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
const run = ($: any, args: string) => $.command.run({ command: 'mode', args })
const step = ($: any) => $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })
const drain = async (s: any) => {
  for await (const _ of s) void _
  return s.result
}

test('unset: no override, nothing written, manual false', async ($, on) => {
  const { steps, store, state, commands } = engine(on)
  await start($)
  await drain(step($))
  expect(steps[0].effort).toBe('medium')
  expect(store.effort).toBeUndefined()
  expect(commands).toEqual([])
  expect(state('mode.manual')).toBe(false)
})

test('set effort: turn.step carries it, it is stored, manual is true', async ($, on) => {
  const { steps, store, state, configSets } = engine(on)
  await start($)
  await run($, 'effort high')
  expect(store.effort).toBe('high')
  expect(configSets).toEqual([])
  await drain(step($))
  expect(steps[0].effort).toBe('high')
  expect(state('mode.manual')).toBe(true)
})

test('a stored effort is applied after a restart, manual starts false', async ($, on) => {
  const { steps, state } = engine(on, { store: { effort: 'max' } })
  await start($)
  await drain(step($))
  expect(steps[0].effort).toBe('max')
  expect(state('mode.manual')).toBe(false)
})

test('effort default clears the override', async ($, on) => {
  const { steps, store } = engine(on, { store: { effort: 'max' } })
  await start($)
  await run($, 'effort default')
  expect(store.effort).toBeUndefined()
  await drain(step($))
  expect(steps[0].effort).toBe('medium')
})

test('an invalid level or alias changes nothing', async ($, on) => {
  const { store, commands, state } = engine(on)
  await start($)
  expect((await run($, 'effort ludicrous')).text).toMatch(/Effort:/)
  expect((await run($, 'model gpt')).text).toMatch(/Model:/)
  expect(store.effort).toBeUndefined()
  expect(commands).toEqual([])
  expect(state('mode.manual')).toBe(false)
})

test('subagent steps are left alone', async ($, on) => {
  const { steps } = engine(on, { store: { effort: 'max' } })
  await start($)
  await drain($.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'low', messageCount: 1, agentId: 'a1' }))
  expect(steps[0].effort).toBe('low')
})

test('set model: runs /model, summary and manual follow', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { commands, state } = engine(on)
  await start($)
  await run($, 'model sonnet')
  await clock.advance(1)
  expect(commands).toEqual([{ command: 'model', args: 'sonnet' }])
  expect(state('mode.manual')).toBe(true)
  expect((state('mode.menuEntry') as any).summary).toBe('Sonnet 4.6 · effort medium')
})

test('menuEntry at start, and effort default when nothing is known', async ($, on) => {
  const { state } = engine(on, { noConfig: true })
  await start($)
  expect(state('mode.menuEntry')).toEqual({ apiVersion: 1, title: 'Mode', summary: 'Opus 5.5 · effort default', order: 3 })
})

test('the page is drawn in the menu pane only when menu.panel is mode', async ($, on) => {
  const { setState, store } = engine(on)
  await start($)
  setState('menu.panel', 'main')
  const closed = await $.ui.mount(menuPane)
  expect(await closed.find({ key: 'effort-high' })).toBeUndefined()
  await closed.unmount()
  setState('menu.panel', 'mode')
  const ui = await $.ui.mount(menuPane)
  expect(await ui.find({ key: 'mods-back' })).toBeDefined()
  await ui.press({ key: 'effort-high' })
  expect(store.effort).toBe('high')
})

test('own pane has no back button and presses switch the model', async ($, on) => {
  const { commands } = engine(on)
  await start($)
  const ui = await $.ui.mount(ownPane)
  expect(await ui.find({ key: 'mods-back' })).toBeUndefined()
  await ui.press({ key: 'model-haiku' })
  expect(commands).toEqual([{ command: 'model', args: 'haiku' }])
})

test('/mode with no argument opens the pane', async ($, on) => {
  const { opened } = engine(on)
  await start($)
  await run($, '')
  expect(opened).toEqual(['mode-settings'])
})

test('/mode effort never writes the user config, default included', async ($, on) => {
  const { configSets } = engine(on)
  await start($)
  await run($, 'effort high')
  await run($, 'effort default')
  expect(configSets).toEqual([])
})

test("the user's own /effort drops our override", async ($, on) => {
  const { steps, store, toasts } = engine(on, { store: { effort: 'max' } })
  await start($)
  await drain(step($)) // engine at medium; ours rides on top
  expect(steps[0].effort).toBe('max')
  await drain($.turn.step({ turnId: 't', index: 1, model: 'claude-opus-5-5', effort: 'low', messageCount: 2 }))
  expect(steps[1].effort).toBe('low')
  expect(store.effort).toBeUndefined()
  expect(toasts).toContain('Effort: following your /effort low')
})

const stepAt = ($: any, index: number, effort: string) => drain($.turn.step({ turnId: 't', index, model: 'claude-opus-5-5', effort, messageCount: 2 }))

test('(a) decision-router: an effort equal to the routed one is not the engine level', async ($, on) => {
  const { steps, store, toasts, state, setState } = engine(on, { store: { effort: 'max' } })
  await start($)
  await drain(step($)) // engine at medium
  setState('decision-router.effort', 'low')
  await stepAt($, 1, 'low')
  expect(toasts).toEqual([])
  expect(store.effort).toBe('max')
  expect(steps[1].effort).toBe('max')
  expect(state('mode.sessionEffort')).toBe('medium')
})

test('(b) decision-router: an effort different from the routed one is still the users', async ($, on) => {
  const { store, toasts, setState } = engine(on, { store: { effort: 'max' } })
  await start($)
  await drain(step($))
  setState('decision-router.effort', 'low')
  await stepAt($, 1, 'high')
  expect(toasts).toContain('Effort: following your /effort high')
  expect(store.effort).toBeUndefined()
})

test('(c) decision-router: absent state or a failing read behaves as before', async ($, on) => {
  const { toasts, store } = engine(on, { store: { effort: 'max' }, throwRouter: true })
  await start($)
  await drain(step($))
  await stepAt($, 1, 'low')
  expect(toasts).toContain('Effort: following your /effort low')
  expect(store.effort).toBeUndefined()
})

test('(d) decision-router: a routed step does not move the last seen engine level', async ($, on) => {
  const { toasts, store, setState } = engine(on, { store: { effort: 'max' } })
  await start($)
  await drain(step($)) // seen: medium
  setState('decision-router.effort', 'low')
  await stepAt($, 1, 'low') // routed: seen stays medium
  setState('decision-router.effort', null)
  await stepAt($, 2, 'medium') // same as seen: not a /effort
  expect(toasts).toEqual([])
  expect(store.effort).toBe('max')
})

test('a model without change is not marked manual', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { state, toasts } = engine(on)
  await start($)
  await run($, 'model opus')
  await clock.advance(1)
  expect(state('mode.manual')).toBe(false)
  expect(toasts).toContain('Model unchanged')
})

test('a throwing store at session start does not break the session', async ($, on) => {
  engine(on, { throwStore: true })
  await start($)
  await drain(step($))
})
