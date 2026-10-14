import { expect, mock, test } from 'claude-code/testing'

import { KEY, ok, tick, drain, answers, reply, engine, start, submit, bandProps, mountBand, step, routed, text, routedState } from './harness'

test('R1 no key: zero fetch, a single toast, the prompt goes through', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches, toasts, timeline, commands } = engine(on, { env: { DECISION_MOD_KEY: '' } })
  await start($)
  await submit($)
  await submit($, 'second')
  expect(fetches).toEqual([])
  expect(toasts).toEqual(['Decision router is idle: DECISION_MOD_KEY is not set'])
  expect(timeline).toEqual(['core-submit', 'core-submit'])
  expect(commands).toEqual([])
})

test('R2 invalid variable: one toast naming it, the default applies and routing goes on', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches, toasts } = engine(on, { env: { DECISION_MOD_MIN_CONFIDENCE: 'abc', DECISION_MOD_SUBAGENTS: 'yes' } })
  await start($)
  const p = submit($)
  await tick()
  expect(fetches).toHaveLength(1)
  expect(toasts).toEqual(['Decision router: invalid DECISION_MOD_MIN_CONFIDENCE, DECISION_MOD_SUBAGENTS, using the default'])
  await (await mountBand($)).press({ key: 'keep' })
  await p
})

test('R4 a slash command is skipped and does not count as the first prompt', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches, timeline } = engine(on)
  await start($)
  await submit($, '/mode effort high')
  expect(fetches).toEqual([])
  expect(timeline).toEqual(['core-submit'])
  await routed($, 'keep') // the next real prompt is still the first one
  expect(fetches).toHaveLength(1)
})

test('R4 a prompt that is not the user\'s own (origin plugin) is not routed', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches, timeline } = engine(on)
  await start($)
  await $.prompt.submit({ text: 'from a hook', wait: false, origin: { kind: 'plugin', name: 'x' } } as any)
  expect(fetches).toEqual([])
  expect(timeline).toEqual(['core-submit'])
})

test('R4 resumed session (turns > 0): no call, no band', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches, timeline } = engine(on, { turns: 3 })
  await start($)
  await submit($)
  expect(fetches).toEqual([])
  expect(timeline).toEqual(['core-submit'])
})

test('R4 R24 second prompt: no decision call, no band, and the turn.step only applies the override', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches, timeline, steps } = engine(on)
  await start($)
  await routed($, 'switch')
  await submit($, 'again')
  await step($, 1)
  expect(fetches).toHaveLength(1)
  expect(timeline).toEqual(['core-submit', 'core-submit'])
  expect(await (await mountBand($)).find({ key: 'switch' })).toBeUndefined()
  expect(steps[0].effort).toBe('xhigh')
})

test('R13 R14 R16 threshold per value: only passing values are switched, each shows its confidence', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { steps, commands } = engine(on, { fetch: () => ({ value: reply(answers(0.9, 0.3)) }) })
  await start($)
  const p = submit($)
  await tick()
  const ui = await mountBand($)
  expect(await text(ui, /Suggested model: opus · confidence 90%/)).toBeDefined()
  expect(await text(ui, /Effort kept: xhigh suggested at 30%, below 60%/)).toBeDefined()
  await ui.press({ key: 'switch' })
  await p
  await step($)
  expect(steps[0].model).toBe('opus')
  expect(steps[0].effort).toBe('medium') // effort did not pass: untouched
  await clock.advance(1)
  expect(commands).toEqual([{ command: 'model', args: 'opus' }])
  expect(await routedState($)).toBe(null)
})

test('R14 model under the threshold is kept and says so; effort alone is switched', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { steps, commands } = engine(on, { env: { DECISION_MOD_MIN_CONFIDENCE: '0.7' }, fetch: () => ({ value: reply(answers(0.65, 0.7)) }) })
  await start($)
  const p = submit($)
  await tick()
  const ui = await mountBand($)
  expect(await text(ui, /Model kept: opus suggested at 65%, below 70%/)).toBeDefined() // boundary: 0.7 >= 0.7 passes for effort
  await ui.press({ key: 'switch' })
  await p
  await step($)
  expect([steps[0].model, steps[0].effort, commands]).toEqual(['claude-opus-5-5', 'xhigh', []])
})

test('R13 R15 nothing passes: the prompt is not held; an informational band without buttons leaves by the mod timer at 10 s', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { steps, timeline } = engine(on, { fetch: () => ({ value: reply(answers(0.2, 0.3)) }) })
  await start($)
  await submit($) // returns without any click
  expect(timeline).toEqual(['core-submit'])
  const ui = await mountBand($)
  expect(await ui.find({ key: 'switch' })).toBeUndefined()
  expect(await ui.find({ key: 'keep' })).toBeUndefined()
  expect(await text(ui, /Model kept: opus suggested at 20%/)).toBeDefined()
  expect(await text(ui, /Effort kept: xhigh suggested at 30%/)).toBeDefined()
  await clock.advance(9999)
  expect(await text(ui, /Model kept/)).toBeDefined()
  await clock.advance(1)
  expect(await text(ui, /Model kept/)).toBeUndefined()
  await step($)
  expect([steps[0].model, steps[0].effort]).toEqual(['claude-opus-5-5', 'medium'])
})

test('R15 Keep: nothing changes and no further call', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { steps, commands, fetches } = engine(on)
  await start($)
  await routed($, 'keep')
  await step($)
  await submit($, 'next')
  await clock.advance(1)
  expect([steps[0].model, steps[0].effort, commands, fetches.length, await routedState($)]).toEqual(['claude-opus-5-5', 'medium', [], 1, null])
})

test('R15a fake clock: a 3 s call leaves 7 s; the band is gone at 10 s from submission; a later click changes nothing', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  let release!: () => void
  const { steps, timeline, commands } = engine(on, { fetch: () => new Promise(r => (release = () => r({ value: reply() }))) })
  await start($)
  const p = submit($)
  await tick()
  await clock.advance(2900) // the call takes 2.9 s (under the 3 s timeout)
  release()
  await tick()
  const ui = await mountBand($)
  expect(await ui.find({ key: 'switch' })).toBeDefined()
  await clock.advance(7099) // 9.999 s from submission
  expect(await ui.find({ key: 'switch' })).toBeDefined()
  expect(timeline).toEqual([])
  await clock.advance(1) // 10 s
  await p
  expect(timeline).toEqual(['core-submit'])
  expect(await ui.find({ key: 'switch' })).toBeUndefined()
  await ui.press({ key: 'switch' }).catch(() => undefined) // too late
  await step($)
  await clock.advance(1)
  expect([steps[0].model, steps[0].effort, commands, await routedState($)]).toEqual(['claude-opus-5-5', 'medium', [], null])
})

test('R15 no click at all within the window: Keep applies', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { steps, timeline } = engine(on)
  await start($)
  const p = submit($)
  await tick()
  await clock.advance(10_000)
  await p
  expect(timeline).toEqual(['core-submit'])
  await step($)
  expect(steps[0].effort).toBe('medium')
})

test('R18 mode.manual true: no call, no band, no change', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches, timeline, steps } = engine(on, { mode: { manual: true } })
  await start($)
  await submit($)
  await step($)
  expect([fetches.length, timeline, steps[0].effort]).toEqual([0, ['core-submit'], 'medium'])
})

test('R19 mode absent (state read fails): treated as manual false, routing goes on', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches } = engine(on, { throwMode: true })
  await start($)
  await routed($, 'keep')
  expect(fetches).toHaveLength(1)
})

test('R19a a stored mode effort: no effort suggestion, the model may still be switched', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { steps, commands } = engine(on, { mode: { effort: 'high' } })
  await start($)
  const p = submit($)
  await tick()
  const ui = await mountBand($)
  expect(await text(ui, /Effort kept: you already chose one in \/mode/)).toBeDefined()
  await ui.press({ key: 'switch' })
  await p
  await step($)
  await clock.advance(1)
  expect([steps[0].model, steps[0].effort, commands, await routedState($)]).toEqual(['opus', 'medium', [{ command: 'model', args: 'opus' }], null])
})

test('R19c switch: model rewritten on request 0 and /model deferred; effort override on every main step, subagents untouched', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { steps, commands, toasts } = engine(on)
  await start($)
  await routed($, 'switch')
  expect(commands).toEqual([]) // nothing runs inside a hook
  expect(await routedState($)).toBe('xhigh') // published while active
  await step($, 0)
  expect(steps[0].model).toBe('opus')
  expect(commands).toEqual([])
  await clock.advance(1)
  expect(commands).toEqual([{ command: 'model', args: 'opus' }])
  await step($, 1)
  await step($, 2, { model: 'claude-opus-5-5' })
  await step($, 0, { agentId: 'sub-1' })
  expect(steps.map((s: any) => [s.model, s.effort])).toEqual([['opus', 'xhigh'], ['claude-opus-5-5', 'xhigh'], ['claude-opus-5-5', 'xhigh'], ['claude-opus-5-5', 'medium']])
  expect(await routedState($)).toBe('xhigh')
  expect(commands).toHaveLength(1) // /model runs once
})

test('R19c release 1: mode.manual becomes true', async ($, on) => {
  const { steps, mode } = engine(on)
  mock.clock(on, { now: 0 })
  await start($)
  await routed($, 'switch')
  await step($, 0)
  mode.manual = true
  await step($, 1)
  await step($, 2)
  expect(steps.map((s: any) => s.effort)).toEqual(['xhigh', 'medium', 'medium'])
  expect(await routedState($)).toBe(null)
})

test('R19c release 2: mode stores an effort', async ($, on) => {
  const { steps, mode } = engine(on)
  mock.clock(on, { now: 0 })
  await start($)
  await routed($, 'switch')
  await step($, 0)
  mode.effort = 'low'
  await step($, 1)
  expect(steps.map((s: any) => s.effort)).toEqual(['xhigh', 'medium'])
  expect(await routedState($)).toBe(null)
})

test("R19c release 3: the user's own /effort on the same model drops the override", async ($, on) => {
  const { steps } = engine(on)
  mock.clock(on, { now: 0 })
  await start($)
  await routed($, 'switch')
  await step($, 0)
  await step($, 1)
  expect(await routedState($)).toBe('xhigh')
  await step($, 2, { effort: 'low' }) // /effort low
  expect(steps.map((s: any) => s.effort)).toEqual(['xhigh', 'xhigh', 'low'])
  expect(await routedState($)).toBe(null)
  await step($, 3, { effort: 'low' })
  expect(steps[3].effort).toBe('low')
})

test('R19c release 3b: the engine level equals the routed one, then the user runs /effort', async ($, on) => {
  const { steps } = engine(on)
  mock.clock(on, { now: 0 })
  await start($)
  await routed($, 'switch')
  await step($, 0, { effort: 'xhigh' }) // baseline == routed
  await step($, 1, { effort: 'xhigh' })
  expect(await routedState($)).toBe('xhigh')
  await step($, 2, { effort: 'low' })
  expect(steps[2].effort).toBe('low')
  expect(await routedState($)).toBe(null)
})

test('R19c release 3c: X to Y to X is caught at Y', async ($, on) => {
  const { steps } = engine(on)
  mock.clock(on, { now: 0 })
  await start($)
  await routed($, 'switch')
  await step($, 0) // medium
  await step($, 1, { effort: 'high' })
  expect(await routedState($)).toBe(null)
  await step($, 2) // back to medium: the user's again, ours is gone
  expect(steps.map((s: any) => s.effort)).toEqual(['xhigh', 'high', 'medium'])
})

test('R19c release 3d: after the model changes (deferred /model), the level is re-baselined and a later /effort still drops the override', async ($, on) => {
  const { steps } = engine(on)
  mock.clock(on, { now: 0 })
  await start($)
  await routed($, 'switch')
  await step($, 0)
  await step($, 1, { model: 'claude-opus-5-6', effort: 'high' }) // new model: new baseline, not a /effort
  expect(await routedState($)).toBe('xhigh')
  expect(steps[1].effort).toBe('xhigh')
  await step($, 2, { model: 'claude-opus-5-6', effort: 'low' })
  expect(steps[2].effort).toBe('low')
  expect(await routedState($)).toBe(null)
})

// Limitation: the kit loads one plugin per test, so mode is not run here. `mode.*` is faked at state.get (as plugins/mode/tests/mode.test.tsx does);
// these tests prove the router's state is null after each release. That a later /effort equal to the old value is seen by mode is T-014 (c)/(d).

test('R20 failed call: toast, nothing applied, no band, no retry', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { fetches, toasts, timeline, steps, commands } = engine(on, { fetch: () => ({ value: { status: 500, ok: false, headers: {}, text: '' } }) })
  await start($)
  await submit($)
  expect(toasts).toEqual(['Decision router: HTTP 500; nothing changed'])
  expect(timeline).toEqual(['core-submit'])
  expect(await (await mountBand($)).find({ key: 'switch' })).toBeUndefined()
  await step($)
  await submit($, 'again')
  await clock.advance(1)
  expect([fetches.length, steps[0].effort, commands]).toEqual([1, 'medium', []])
})

test('R3 R23 a switch writes nothing (config, store, files) and sends only the prompt as state', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { writes, fetches } = engine(on)
  await start($)
  await routed($, 'switch')
  await step($)
  await clock.advance(1)
  expect(writes).toEqual([])
  expect(JSON.parse(fetches[0].init?.body ?? fetches[0].body).state).toEqual({ prompt: 'refactor the whole parser' })
})

test('R3 R23 no permission or tool-check hook: tool.check passes through unchanged, even with a switch applied', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  on('tool.check', () => ({ decision: 'ask', reason: 'core says ask' }))
  await start($)
  await routed($, 'switch')
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'ls' } } as any)
  expect([r.decision, r.reason, r.hook]).toEqual(['ask', 'core says ask', undefined])
})

test('a failing publish leaves nothing applied: toast, no model rewrite, no override', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { toasts, steps, commands } = engine(on, { throwSet: true })
  await start($)
  await routed($, 'switch')
  await step($)
  await clock.advance(1)
  expect(toasts.some(t => /nothing changed/.test(t))).toBe(true)
  expect([steps[0].model, steps[0].effort, commands]).toEqual(['claude-opus-5-5', 'medium', []])
})

test('R19c the user picks in /mode during the hold: the model switch and its deferred /model are dropped, so is the effort', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { steps, commands, mode } = engine(on)
  await start($)
  const p = submit($)
  await tick()
  const ui = await mountBand($)
  await ui.press({ key: 'switch' })
  await p
  mode.manual = true // picked in /mode before the first request
  await step($, 0)
  await clock.advance(1)
  expect([steps[0].model, steps[0].effort, commands, await routedState($)]).toEqual(['claude-opus-5-5', 'medium', [], null])
})
