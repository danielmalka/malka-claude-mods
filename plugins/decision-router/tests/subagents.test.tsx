import { expect, mock, test } from 'claude-code/testing'

const ok = { value: undefined } as any
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms))
const drain = async (s: any) => {
  for await (const _ of s) void _
  return s.result
}
const answers = (mc: number, ec: number, model = 'opus') => ({
  answers: {
    model: { type: 'choice', choice: model, confidence: mc, probabilities: { haiku: 0.05, sonnet: 0.05, opus: 0.9 } },
    effort: { type: 'score', score: 3, confidence: ec, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 } },
  },
})
const reply = (a = answers(0.9, 0.8)) => ({ status: 200, ok: true, headers: {}, text: JSON.stringify(a) })

type Opts = { env?: Record<string, string>; fetch?: (e: any) => any; noAgentId?: boolean; roster?: any[]; deny?: boolean }
function engine(on: any, o: Opts = {}) {
  const env = { DECISION_MOD_KEY: 'k-test-123', ...o.env }
  const fetches: any[] = []
  const toasts: string[] = []
  const spawns: any[] = []
  const steps: any[] = []
  const writes: string[] = []
  let n = 0
  on('env.get', (_$: any, e: any) => ({ value: env[e.name ?? e.key] }))
  on('http.fetch', (_$: any, e: any) => (fetches.push(e), o.fetch ? o.fetch(e) : { value: reply() }))
  on('session.turns', () => ({ value: 0 }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), ok))
  on('command.run', () => ({ text: '' }))
  for (const ev of ['fs.write', 'config.set', 'store.set', 'store.delete']) on(ev, () => (writes.push(ev), ok))
  on('agent.spawn', (_$: any, e: any) => (spawns.push(e), o.deny ? { deny: 'refused' } : { model: e.model ?? 'parent-model', ...(o.noAgentId ? {} : { agentId: `sub-${++n}` }) }))
  on('tool.call', (_$: any, e: any) => ({ result: { answers: { [e.questions[0].question]: 'Switch' } }, text: 'Switch', ref: 1 }))
  on('agent.list', () => ({ value: o.roster ?? [] }))
  on('state.set', (_$: any, e: any) => ({ value: { isSet: true, version: 1 } }))
  on('state.get', (_$: any, e: any) => ({ value: { value: null, version: 0 } }))
  on('turn.step', async function* (_$: any, e: any) {
    steps.push(e)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as any
  })
  on('ui.render', async ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return { fetches, toasts, spawns, steps, writes }
}

const start = ($: any) => $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
const spawn = ($: any, extra: any = {}) => $.agent.spawn({ prompt: 'read the files', description: 'reader', ...extra })
const bandProps = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { bodyRows: 10 }, view: {} }
const mountBand = ($: any) => $.ui.mount({ plugin: 'decision-router', surface: 'terminal', component: 'AbovePrompt', props: bandProps } as any)
const text = (ui: any, re: RegExp) => ui.find({ type: 'Text', text: re })
const step = ($: any, extra: any = {}) => drain($.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1, ...extra }))
const asyncSpawn = async ($: any, key: 'switch' | 'keep', extra: any = {}) => {
  const p = spawn($, extra)
  await tick()
  const ui = await mountBand($)
  await ui.press({ key: `${key}-sub1` })
  const r = await p
  await ui.unmount()
  return r
}

test('R5 explicit model: untouched, no call; absent and inherit are routed', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches, spawns } = engine(on, { env: { DECISION_MOD_SUBAGENTS: 'auto' } })
  await start($)
  expect((await spawn($, { model: 'opus' })).model).toBe('opus')
  expect(fetches).toEqual([])
  await spawn($)
  await spawn($, { model: 'inherit' })
  expect(fetches).toHaveLength(2)
  expect(spawns.map((s: any) => s.model)).toEqual(['opus', 'opus', 'opus'])
})

test('R6 off: no call, nothing changed', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches, spawns, toasts } = engine(on, { env: { DECISION_MOD_SUBAGENTS: 'off' } })
  await start($)
  await spawn($)
  expect([fetches.length, spawns[0].model, toasts]).toEqual([0, undefined, []])
})

test('R17 ask Switch: model rewritten in agent.spawn, effort on that agentId only; confidence visible; sends the subagent prompt', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { spawns, steps, fetches } = engine(on)
  await start($)
  const p = spawn($)
  await tick()
  const ui = await mountBand($)
  expect(await text(ui, /Suggested model: opus · confidence 90%/)).toBeDefined()
  expect(await text(ui, /Suggested effort: xhigh · confidence 80%/)).toBeDefined()
  await ui.press({ key: 'switch-sub1' })
  const r = await p
  expect([r.model, r.agentId, spawns[0].model]).toEqual(['opus', 'sub-1', 'opus'])
  expect(JSON.parse(fetches[0].init?.body ?? fetches[0].body).state).toEqual({ prompt: 'read the files' })
  await step($, { agentId: 'sub-1' })
  await step($, { agentId: 'sub-2' })
  await step($)
  expect(steps.map((s: any) => s.effort)).toEqual(['xhigh', 'medium', 'medium'])
})

test('R17 ask Keep: runs as spawned', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { spawns, steps } = engine(on)
  await start($)
  await asyncSpawn($, 'keep')
  await step($, { agentId: 'sub-1' })
  expect([spawns[0].model, steps[0].effort]).toEqual([undefined, 'medium'])
})

test('R17 ask no click: the mod timer removes the band at 10 s from the spawn and the subagent runs as spawned', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { spawns } = engine(on)
  await start($)
  const p = spawn($)
  await tick()
  const ui = await mountBand($)
  await clock.advance(9999)
  expect(await ui.find({ key: 'switch-sub1' })).toBeDefined()
  await clock.advance(1)
  await p
  expect(spawns[0].model).toBeUndefined()
  expect(await ui.find({ key: 'switch-sub1' })).toBeUndefined()
})

test('R17 ask, one value below the threshold: shown with its confidence and kept', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { spawns, steps } = engine(on, { fetch: () => ({ value: reply(answers(0.9, 0.3)) }) })
  await start($)
  const p = spawn($)
  await tick()
  const ui = await mountBand($)
  expect(await text(ui, /Effort kept: xhigh suggested at 30%, below 60%/)).toBeDefined()
  await ui.press({ key: 'switch-sub1' })
  await p
  await step($, { agentId: 'sub-1' })
  expect([spawns[0].model, steps[0].effort]).toEqual(['opus', 'medium'])
})

test('R17 ask, nothing passes: not held, informational band without buttons leaves at 10 s', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { spawns } = engine(on, { fetch: () => ({ value: reply(answers(0.2, 0.3)) }) })
  await start($)
  await spawn($) // returns without a click
  expect(spawns[0].model).toBeUndefined()
  const ui = await mountBand($)
  expect(await ui.find({ key: 'switch-sub1' })).toBeUndefined()
  expect(await text(ui, /Model kept: opus suggested at 20%/)).toBeDefined()
  await clock.advance(10_000)
  expect(await text(ui, /Model kept/)).toBeUndefined()
})

test('R17 auto: passing values applied with a toast naming confidences, no band', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { spawns, steps, toasts } = engine(on, { env: { DECISION_MOD_SUBAGENTS: 'auto' } })
  await start($)
  await spawn($)
  expect(toasts).toEqual(['Decision router, subagent: model opus applied (90%); effort xhigh applied (80%)'])
  expect(await (await mountBand($)).find({ key: 'switch-sub1' })).toBeUndefined()
  await step($, { agentId: 'sub-1' })
  expect([spawns[0].model, steps[0].effort]).toEqual(['opus', 'xhigh'])
})

test('R17 auto below the threshold: left as spawned, toast says kept with the confidence', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { spawns, steps, toasts } = engine(on, { env: { DECISION_MOD_SUBAGENTS: 'auto' }, fetch: () => ({ value: reply(answers(0.4, 0.3)) }) })
  await start($)
  await spawn($)
  expect(toasts).toEqual(['Decision router, subagent: model kept (opus suggested at 40%, below 60%); effort kept (xhigh suggested at 30%, below 60%)'])
  await step($, { agentId: 'sub-1' })
  expect([spawns[0].model, steps[0].effort]).toEqual([undefined, 'medium'])
})

test('R19b agentId unknown from next(e): the roster ($.agent.list) finds it', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { steps } = engine(on, { env: { DECISION_MOD_SUBAGENTS: 'auto' }, noAgentId: true, roster: [{ id: 'late-1', description: 'reader', type: 'x', status: 'running' }] })
  await start($)
  await spawn($)
  await step($, { agentId: 'other' }) // not ours
  await step($, { agentId: 'late-1' })
  await step($, { agentId: 'late-1', index: 1 })
  expect(steps.map((s: any) => s.effort)).toEqual(['medium', 'xhigh', 'xhigh'])
})

test('R17 R19b two simultaneous spawns: independent bands and state', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { spawns, steps } = engine(on, {
    fetch: (e: any) => {
      const prompt = JSON.parse(e.init?.body ?? e.body).state.prompt
      return { value: reply(prompt === 'first' ? answers(0.9, 0.8, 'haiku') : answers(0.9, 0.8, 'opus')) }
    },
  })
  await start($)
  const p1 = spawn($, { prompt: 'first', description: 'one' })
  const p2 = spawn($, { prompt: 'second', description: 'two' })
  await tick()
  const ui = await mountBand($)
  expect(await ui.find({ key: 'keep-sub1' })).toBeDefined()
  expect(await ui.find({ key: 'keep-sub2' })).toBeDefined()
  await ui.press({ key: 'switch-sub2' })
  const r2 = await p2
  expect(await ui.find({ key: 'keep-sub1' })).toBeDefined() // the other band stays
  await ui.press({ key: 'keep-sub1' })
  const r1 = await p1
  expect([r1.model, r2.model]).toEqual(['parent-model', 'opus'])
  await step($, { agentId: r1.agentId })
  await step($, { agentId: r2.agentId })
  expect(steps.map((s: any) => s.effort)).toEqual(['medium', 'xhigh'])
  expect(spawns).toHaveLength(2)
})

test('R20 failed call: toast, subagent unchanged, no retry', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches, toasts, spawns } = engine(on, { fetch: () => ({ value: { status: 500, ok: false, headers: {}, text: '' } }) })
  await start($)
  await spawn($)
  expect(toasts).toEqual(['Decision router: subagent HTTP 500; nothing changed'])
  expect([fetches.length, spawns[0].model]).toEqual([1, undefined])
})

test('R1 no key: the idle toast is shown once for subagents, no call', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches, toasts } = engine(on, { env: { DECISION_MOD_KEY: '' } })
  await start($)
  await spawn($)
  await spawn($)
  expect(fetches).toEqual([])
  expect(toasts).toEqual(['Decision router is idle: DECISION_MOD_KEY is not set'])
})

test('a subagent step does not touch the main override or its baseline', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { steps } = engine(on, { env: { DECISION_MOD_SUBAGENTS: 'off' } })
  await start($)
  await $.prompt.submit({ text: 'refactor the whole parser', wait: false }) // the main dialog answers Switch
  await step($, { index: 0 }) // main: baseline medium, ours xhigh
  await step($, { agentId: 'sub-x', effort: 'low' }) // a subagent at another level
  await step($, { index: 1 }) // main again at medium: no /effort happened
  expect(steps.map((s: any) => s.effort)).toEqual(['xhigh', 'low', 'xhigh'])
})

test('R3 R23 subagent routing writes nothing and leaves tool.check untouched', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { writes } = engine(on, { env: { DECISION_MOD_SUBAGENTS: 'auto' } })
  on('tool.check', () => ({ decision: 'ask', reason: 'core says ask' }))
  await start($)
  await spawn($)
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'ls' } } as any)
  expect([writes, r.decision, r.reason, r.hook]).toEqual([[], 'ask', 'core says ask', undefined])
})

test('forks and teammates pass through: no call, no band, no toast', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches, toasts, spawns } = engine(on, { env: { DECISION_MOD_SUBAGENTS: 'auto' } })
  await start($)
  await spawn($, { fork: true } as any)
  await spawn($, { isTeammate: true } as any)
  expect([fetches.length, toasts, spawns.map((s: any) => s.model)]).toEqual([0, [], [undefined, undefined]])
  expect(spawns.map((s: any) => Boolean(s.fork || s.isTeammate))).toEqual([true, true])
})

const rosterOf = (...ids: string[]) => ids.map(id => ({ id, description: 'reader', type: 'general-purpose', status: 'running' }))

test('R19b fallback: two same-description spawns, one Kept: no effort goes to the wrong agent', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { steps } = engine(on, { noAgentId: true, roster: rosterOf('a', 'b') })
  await start($)
  const p1 = spawn($, { subagentType: 'general-purpose' })
  await tick()
  const ui = await mountBand($)
  await ui.press({ key: 'switch-sub1' })
  await p1
  const p2 = spawn($, { subagentType: 'general-purpose' })
  await tick()
  await (await mountBand($)).press({ key: 'keep-sub2' })
  await p2
  await step($, { agentId: 'a' })
  await step($, { agentId: 'b' })
  expect(steps.map((s: any) => s.effort)).toEqual(['medium', 'medium'])
})

test('R19b fallback: two pending entries with the same description are ambiguous: no effort', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { steps } = engine(on, { env: { DECISION_MOD_SUBAGENTS: 'auto' }, noAgentId: true, roster: rosterOf('a', 'b') })
  await start($)
  await spawn($)
  await spawn($)
  await step($, { agentId: 'a' })
  await step($, { agentId: 'b' })
  expect(steps.map((s: any) => s.effort)).toEqual(['medium', 'medium'])
})

test('R19b fallback: a stale entry (no agentId ever claimed it) expires and never lands on a later agent', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { steps } = engine(on, { env: { DECISION_MOD_SUBAGENTS: 'auto' }, noAgentId: true, roster: rosterOf('late') })
  await start($)
  await spawn($)
  await clock.advance(11_000)
  await step($, { agentId: 'late' })
  expect(steps[0].effort).toBe('medium')
})

test('R19b fallback: an agent already known from another spawn is never a candidate', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { steps } = engine(on, { env: { DECISION_MOD_SUBAGENTS: 'auto' }, roster: rosterOf('sub-1', 'sub-2') })
  await start($)
  await spawn($) // gets sub-1 from next(e)
  await step($, { agentId: 'sub-2' }) // not ours: nothing pending
  await step($, { agentId: 'sub-1' })
  expect(steps.map((s: any) => s.effort)).toEqual(['medium', 'xhigh'])
})

test('turn.complete forgets the agent effort', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { steps } = engine(on, { env: { DECISION_MOD_SUBAGENTS: 'auto' } })
  on('turn.complete', () => ({ text: '' }))
  await start($)
  await spawn($)
  await step($, { agentId: 'sub-1' })
  await $.turn.complete({ turnId: 't', agentId: 'sub-1', answer: '', reason: 'answer' } as any).catch(() => undefined)
  await step($, { agentId: 'sub-1' })
  expect(steps.map((s: any) => s.effort)).toEqual(['xhigh', 'medium'])
})

test('R17 auto: a denied spawn shows no "applied" toast and keeps no effort', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { toasts, steps } = engine(on, { env: { DECISION_MOD_SUBAGENTS: 'auto' }, deny: true })
  await start($)
  expect((await spawn($)).deny).toBe('refused')
  expect(toasts).toEqual([])
  await step($, { agentId: 'sub-1' })
  expect(steps[0].effort).toBe('medium')
})

test('session.start during a held spawn: the hold ends as Keep, the band goes, ids restart in the new session', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { spawns } = engine(on)
  await start($)
  const p = spawn($)
  await tick()
  const ui = await mountBand($)
  expect(await ui.find({ key: 'switch-sub1' })).toBeDefined()
  await start($)
  await p
  expect(spawns[0].model).toBeUndefined()
  expect(await ui.find({ key: 'switch-sub1' })).toBeUndefined()
  await clock.advance(1000)
  const p2 = spawn($)
  await tick()
  const ui2 = await mountBand($)
  expect(await ui2.find({ key: 'switch-sub1' })).toBeDefined() // counter restarted
  await ui2.press({ key: 'keep-sub1' })
  await p2
})

test('R17 a late click on a sub band changes nothing', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { spawns, steps } = engine(on)
  await start($)
  const p = spawn($)
  await tick()
  const ui = await mountBand($)
  await clock.advance(10_000)
  await p
  await ui.press({ key: 'switch-sub1' }).catch(() => undefined)
  await step($, { agentId: 'sub-1' })
  expect([spawns[0].model, steps[0].effort]).toEqual([undefined, 'medium'])
})

test('R15a for subagents: a slow call (2.9 s) leaves 7.1 s; the hold never exceeds 10 s from the spawn', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  let release!: () => void
  const { spawns } = engine(on, { fetch: () => new Promise(r => (release = () => r({ value: reply() }))) })
  await start($)
  const p = spawn($)
  await tick()
  await clock.advance(2900)
  release()
  await tick()
  const ui = await mountBand($)
  await clock.advance(7099)
  expect(await ui.find({ key: 'switch-sub1' })).toBeDefined()
  await clock.advance(1)
  await p
  expect(spawns[0].model).toBeUndefined()
  expect(await ui.find({ key: 'switch-sub1' })).toBeUndefined()
})

test('R3 R23 routing leaves the permission path alone: tool.check answers the same before and after, no router hook field', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on, { env: { DECISION_MOD_SUBAGENTS: 'auto' } })
  on('tool.check', () => ({ decision: 'ask', reason: 'core says ask' }))
  await start($)
  const call = { tool: 'Bash', input: { command: 'ls' } } as any
  const before = await $.tool.check(call)
  await spawn($)
  const after = await $.tool.check(call)
  expect(after).toEqual(before)
  expect(after.hook).toBeUndefined()
})
