import { expect, mock, test } from 'claude-code/testing'

import { KEY, ok, tick, drain, answers, reply, engine, start, submit, bandProps, mountBand, step, routed, text, routedState } from './harness'

test('session.start with a band open: it is released as Keep, the old band and timer are gone, the new session routes again', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { fetches, timeline, steps } = engine(on)
  await start($)
  const p = submit($)
  await tick()
  const ui = await mountBand($)
  expect(await ui.find({ key: 'switch' })).toBeDefined()
  await start($) // restart
  await p
  expect(timeline).toEqual(['core-submit'])
  expect(await ui.find({ key: 'switch' })).toBeUndefined()
  await clock.advance(5000)
  const p2 = submit($, 'second session prompt')
  await tick()
  expect(fetches).toHaveLength(2)
  const ui2 = await mountBand($)
  await clock.advance(5000) // the old session's 10 s would be due now
  expect(await ui2.find({ key: 'switch' })).toBeDefined()
  await ui2.press({ key: 'switch' })
  await p2
  await step($)
  expect(steps[0].model).toBe('opus')
})

test('two prompts in quick succession: one decision call', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { fetches, timeline } = engine(on)
  await start($)
  const p1 = submit($)
  const p2 = submit($, 'second right behind')
  await tick()
  expect(fetches).toHaveLength(1)
  await (await mountBand($)).press({ key: 'keep' })
  await Promise.all([p1, p2])
  expect(timeline).toHaveLength(2)
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
  expect(await (await mountBand($)).find({ key: 'switch' })).toBeUndefined() // no band from the old session
  await step($)
  await clock.advance(1)
  expect([steps[0].model, steps[0].effort, commands, await routedState($)]).toEqual(['claude-opus-5-5', 'medium', [], null])
  await routed($, 'keep') // the new session routes its first prompt again
  expect(fetches).toHaveLength(2)
})

test('a throwing timer leaves no band standing', async ($, on) => {
  const { timeline } = engine(on)
  on('clock.now', () => ({ value: 0 }))
  on('clock.after', (_$: any, e: any) => {
    if (e.ms === 10_000) throw new Error('clock down')
    return ok
  })
  await start($)
  await submit($)
  expect(timeline).toEqual(['core-submit'])
  expect(await (await mountBand($)).find({ key: 'switch' })).toBeUndefined()
})
