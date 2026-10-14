import { expect, mock, test } from 'claude-code/testing'

import { ok, answers, reply, engine, start, submit, mountBand, step, routed, routedState, tick, dialog } from './harness'

test('session.start with the dialog open: the old answer applies nothing, the new session routes again', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { fetches, timeline, steps, commands } = engine(on)
  await start($)
  let release!: () => void
  dialog.gate = new Promise<void>(r => (release = r))
  const p = submit($)
  await tick()
  expect(dialog.asked).toHaveLength(1)
  await start($) // restart; $.ui.ask has no cancel, so the old dialog stays open until answered
  dialog.answer = 'Switch'
  release() // the user answers the old dialog: Switch
  await p
  expect(timeline).toEqual(['core-submit'])
  await step($)
  await clock.advance(1)
  expect([steps[0].model, steps[0].effort, commands, await routedState($)]).toEqual(['claude-opus-5-5', 'medium', [], null])
  dialog.gate = null
  await routed($, 'switch') // the new session's first prompt is routed again
  expect(fetches).toHaveLength(2)
  await step($, 0)
  expect(steps[1].model).toBe('opus')
})

test('two prompts in quick succession: one decision call, one dialog', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches, timeline } = engine(on)
  await start($)
  let release!: () => void
  dialog.gate = new Promise<void>(r => (release = r))
  const p1 = submit($)
  const p2 = submit($, 'second right behind')
  await tick()
  expect(fetches).toHaveLength(1)
  release()
  await Promise.all([p1, p2])
  expect([timeline.length, dialog.asked.length]).toEqual([2, 1])
})

test('a second session.start after a Switch clears the override and the published state; the next first prompt is routed again', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { fetches, steps } = engine(on)
  await start($)
  await routed($, 'switch')
  expect(await routedState($)).toBe('xhigh')
  await start($)
  expect(await routedState($)).toBe(null)
  await step($, 0)
  await clock.advance(1)
  expect(steps[0].effort).toBe('medium')
  await routed($, 'keep')
  expect(fetches).toHaveLength(2)
})

test('session.start while the decision call is in flight: the old result applies nothing, the new session is clean', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  let release!: () => void
  let first = true
  const { fetches, steps, timeline, commands } = engine(on, {
    fetch: () => {
      if (!first) return { value: reply() }
      first = false
      return new Promise(r => (release = () => r({ value: reply() })))
    },
  })
  await start($)
  const p = submit($)
  await tick()
  await start($) // restart while the call is out
  release()
  await p
  await tick()
  expect(timeline).toEqual(['core-submit'])
  expect(dialog.asked).toHaveLength(0)
  await step($)
  await clock.advance(1)
  expect([steps[0].model, steps[0].effort, commands, await routedState($)]).toEqual(['claude-opus-5-5', 'medium', [], null])
  await routed($, 'keep') // the new session routes its first prompt again
  expect(fetches).toHaveLength(2)
})

test('a throwing timer leaves no informational band standing', async ($, on) => {
  const { timeline } = engine(on, { fetch: () => ({ value: reply(answers(0.2, 0.3)) }) })
  on('clock.now', () => ({ value: 0 }))
  on('clock.after', (_$: any, e: any) => {
    if (e.ms === 10_000) throw new Error('clock down')
    return ok
  })
  await start($)
  await submit($)
  expect(timeline).toEqual(['core-submit'])
  expect(await (await mountBand($)).find({ type: 'Text', text: /kept/ })).toBeUndefined()
})
