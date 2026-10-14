import { expect, mock, test } from 'claude-code/testing'

const props = {
  hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100,
  scroll: {}, view: {},
} as any
const band = { plugin: 'sentinel', surface: 'terminal', component: 'AbovePrompt', props } as const

test('subagent: band while running, stall toast and completion toast', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined } as any))
  on('ui.invalidate', () => ({ value: undefined }) as any)
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  }) // what the engine would draw
  on('agent.spawn', () => ({ model: 'x', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))

  // nothing running: draws nothing
  const idle = await $.ui.mount(band)
  expect(await idle.find({ type: 'Text', text: /running/ })).toBeUndefined()

  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'builder', subagentType: 'general-purpose', background: true, fork: false, parentModel: 'm' } as any)
  await clock.advance(60_000)
  const live = await $.ui.mount(band)
  expect((await live.find({ type: 'Text', text: /⏳ 1 running · builder 1m \(active 1m ago\)/ }))).toBeDefined()

  await clock.advance(5 * 60_000)
  expect(toasts.some(t => t.includes('builder stalled'))).toBe(true)
  expect(toasts.filter(t => t.includes('stalled')).length).toBe(1) // only once

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
  expect(toasts.some(t => /all done \(1 tasks, 6m\)/.test(t))).toBe(true)
  const done = await $.ui.mount(band)
  expect(await done.find({ type: 'Text', text: /✓ done · ✓ builder/ })).toBeDefined()

  await clock.advance(61_000)
  const gone = await $.ui.mount(band)
  expect(await gone.find({ type: 'Text', text: /builder/ })).toBeUndefined()
})

test('background Bash: enters via backgroundTaskId, leaves via task-notification, never "stalled"', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const toasts: string[] = []
  const ok = { value: undefined } as any
  on('ui.toast', (_$, e) => (toasts.push(e.text), ok))
  on('ui.invalidate', () => ok)
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' }, text: '', ref: 1 }) as any)
  on('prompt.submit', (_$, e) => ({ text: e.text }))

  await $.tool.call({ tool: 'Bash', command: 'timeout 900 codex review --long-flag', run_in_background: true })
  await clock.advance(10 * 60_000)
  const live = await $.ui.mount(band)
  expect(await live.find({ type: 'Text', text: /⏳ 1 running · timeout 900 codex review --lon 10m$/ })).toBeDefined()
  expect(toasts.length).toBe(0)

  await $.prompt.submit({ text: '<task-notification><task-id>bg1</task-id><status>completed</status></task-notification>', origin: { kind: 'task-notification' }, wait: false } as any)
  expect(toasts.some(t => /all done \(1 tasks, 10m\)/.test(t))).toBe(true)
})

test('background Bash: also finishes via the UserMessage task-notification render', async ($, on) => {
  mock.clock(on, { now: 0 })
  const toasts: string[] = []
  const ok = { value: undefined } as any
  on('ui.toast', (_$, e) => (toasts.push(e.text), ok))
  on('ui.invalidate', () => ok)
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg2' }, text: '', ref: 1 }) as any)

  await $.tool.call({ tool: 'Bash', command: 'sleep 5', run_in_background: true })
  await $.ui.mount({ plugin: 'sentinel', surface: 'terminal', component: 'UserMessage', props: { origin: { kind: 'task-notification' }, task: { id: 'bg2' } } } as any)
  expect(toasts.some(t => /all done \(1 tasks, 0s\)/.test(t))).toBe(true)
})
