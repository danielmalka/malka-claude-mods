export const KEY = 'k-test-123'
export const ok = { value: undefined } as any
export const tick = (ms = 20) => new Promise(r => setTimeout(r, ms))
export const drain = async (s: any) => {
  for await (const _ of s) void _
  return s.result
}
export const answers = (mc: number, ec: number, model = 'opus', effort = 3) => ({
  answers: {
    model: { type: 'choice', choice: model, confidence: mc, probabilities: { haiku: 0.05, sonnet: 0.05, opus: 0.9 } },
    effort: { type: 'score', score: effort, confidence: ec, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 } },
  },
})
export const reply = (a = answers(0.9, 0.8)) => ({ status: 200, ok: true, headers: {}, text: JSON.stringify(a) })

export let vals = new Map<string, unknown>()
export type Opts = { env?: Record<string, string>; turns?: number; mode?: Record<string, unknown>; fetch?: (e: any) => any; throwMode?: boolean; throwSet?: boolean }
// What the engine answers beneath the plugin. `mode.*` state is faked (the kit loads one plugin); decision-router.* is the real atom.
export function engine(on: any, o: Opts = {}) {
  const env = { DECISION_MOD_KEY: KEY, ...o.env }
  const mode: Record<string, unknown> = { ...o.mode }
  const fetches: any[] = []
  const toasts: string[] = []
  const commands: any[] = []
  const steps: any[] = []
  const timeline: string[] = []
  const writes: string[] = []
  vals = new Map()
  on('env.get', (_$: any, e: any) => ({ value: env[e.name ?? e.key] }))
  on('http.fetch', (_$: any, e: any) => (fetches.push(e), o.fetch ? o.fetch(e) : { value: reply() }))
  on('session.turns', () => ({ value: o.turns ?? 0 }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$: any, e: any) => (timeline.push('core-submit'), { text: e.text }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), ok))
  on('command.run', (_$: any, e: any) => (commands.push({ command: e.command, args: e.args }), { text: '' }))
  for (const ev of ['fs.write', 'config.set', 'store.set', 'store.delete']) on(ev, (_$: any, e: any) => (writes.push(ev), ok))
  on('state.set', (_$: any, e: any, next: any) => (o.throwSet && e.plugin === 'decision-router' && e.value !== null ? { value: { isSet: false, version: 9 } } : (vals.set(`${e.plugin}.${e.key}`, e.value), e.plugin === 'decision-router' ? { value: { isSet: true, version: 1 } } : next(e))))
  on('state.get', (_$: any, e: any, next: any) => {
    if (e.plugin === 'decision-router') return { value: { value: vals.get(`${e.plugin}.${e.key}`), version: 0 } }
    if (e.plugin !== 'mode') return next(e)
    if (o.throwMode) throw new Error('no such plugin')
    return { value: { value: mode[e.key] ?? null, version: 0 } }
  })
  on('turn.step', async function* (_$: any, e: any) {
    steps.push(e)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as any
  })
  on('ui.render', async ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return { fetches, toasts, commands, steps, timeline, writes, mode }
}

export const start = ($: any) => $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
export const submit = ($: any, text = 'refactor the whole parser') => $.prompt.submit({ text, wait: false })
export const bandProps = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { bodyRows: 10 }, view: {} }
export const mountBand = ($: any) => $.ui.mount({ plugin: 'decision-router', surface: 'terminal', component: 'AbovePrompt', props: bandProps } as any)
export const step = ($: any, index = 0, extra: any = {}) => drain($.turn.step({ turnId: 't', index, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1, ...extra }))

// Submit, wait for the band, press, finish.
export async function routed($: any, key: 'switch' | 'keep') {
  const p = submit($)
  await tick()
  const ui = await mountBand($)
  await ui.press({ key })
  await p
  await ui.unmount()
}
export const text = (ui: any, re: RegExp) => ui.find({ type: 'Text', text: re })
export const routedState = async (_$: any) => vals.get('decision-router.effort') ?? null
