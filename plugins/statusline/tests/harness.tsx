export const ok = { value: undefined } as any
export const SETTINGS = '/cfg/settings.json'
export const BAK = `${SETTINGS}.statusline.bak`
export const USER_LINE = { type: 'command', command: 'echo mine' }

export const hintProps = { hint: 'esc to interrupt', columns: 140 } as any
export const hint = { plugin: 'statusline', surface: 'terminal', component: 'PromptHint', props: hintProps, viewport: { columns: 140, rows: 40 } } as any
export const band = (bodyColumns = 140, props: object = {}) =>
  ({ plugin: 'statusline', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { bodyRows: 10 }, view: {}, ...props } }) as any
export const menuPane = (panel: string) => ({ plugin: 'statusline', surface: 'terminal', component: 'Pane', requestId: 'mods-menu', props: { bodyColumns: 60, scroll: { bodyRows: 10 }, view: {} } }) as any

// what the engine would answer beneath the plugin
export function engine(on: any, opts: { store?: Record<string, unknown>; files?: Record<string, string>; menu?: Record<string, unknown>; noUsage?: boolean; pct?: () => number } = {}) {
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
    value: { context: { percent: opts.pct ? opts.pct() : 41, tokens: 82_000, window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: new Date(3_600_000).toISOString() }, { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(400_000_000).toISOString() }] },
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
  // a main-loop response with usage: the statusline stamps lastResponseAt from it, which makes the cache segment appear
  on('turn.step', async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } } as any
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), ok))
  on('command.register', () => ok)
  on('ui.open', (_$: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.render', async ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return e.component === 'AbovePrompt' ? <Box><Text key="other">from beneath</Text></Box> : <Box />
  })
  return { store, files, toasts, order, opened, state: (k: string) => vals.get(k), setState: (k: string, v: unknown) => (vals.set(k, v), ver.set(k, (ver.get(k) ?? 0) + 1)) }
}

export const run = ($: any, args: string) => $.command.run({ command: 'statusline', args })

