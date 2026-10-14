import { expect, mock, test } from 'claude-code/testing'

const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140, scroll: {}, view: {} } as any
const band = { plugin: 'resume', surface: 'terminal', component: 'AbovePrompt', props } as const
const ok = { value: undefined } as any
const KEY = 'resume:/work'
const crashed = {
  open: true, sessionId: 'old', startedAt: 1, lastSeen: 1, cwd: '/work',
  lastPrompt: 'fix bug X', branch: 'main', dirty: [' M a.go'], dirtyCount: 1,
}

// what the engine would answer beneath the plugins
const engine = (on: any, sessionId: string, store: Record<string, unknown>) => {
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: any, e: any) => ((store[e.key] = e.value), ok))
  on('store.delete', (_$: any, e: any) => (delete store[e.key], ok))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.id', () => ({ value: sessionId }))
  on('ui.render', async ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}

test('previous open session with another sessionId: band, Resume sends the prompt and clears', async ($, on) => {
  engine(on, 'new', { [KEY]: crashed })
  mock.clock(on, { now: 10_000_000 }) // well after the last heartbeat
  const prompts: string[] = []
  on('prompt.submit', (_$, e) => (prompts.push(e.text), { text: e.text }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(band)
  expect(await ui.find({ type: 'Text', text: /interrupted at \d\d:\d\d during: "fix bug X" · main · 1 changed files/ })).toBeDefined()

  await ui.press({ key: 'resume' })
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('fix bug X')
  expect(prompts[0]).toContain('M a.go')
  expect(prompts[0]).toContain('git status')
  expect(await (await $.ui.mount(band)).find({ key: 'resume' })).toBeUndefined()
})

test('same sessionId (reload) or closed checkpoint: nothing in the band', async ($, on) => {
  engine(on, 'old', { [KEY]: crashed })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(await (await $.ui.mount(band)).find({ key: 'resume' })).toBeUndefined()
})

test('another live session in the same cwd (recent heartbeat): nothing in the band', async ($, on) => {
  engine(on, 'new', { [KEY]: { ...crashed, lastSeen: 1_000_000 } })
  mock.clock(on, { now: 1_030_000 })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(await (await $.ui.mount(band)).find({ key: 'resume' })).toBeUndefined()
})

test('claude -p (non-interactive) does not write a checkpoint', async ($, on) => {
  const store: Record<string, unknown> = {}
  engine(on, 's2', store)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
  await $.turn.start({ text: 'x', turnId: 't1' })
  expect(store[KEY]).toBeUndefined()
})

test('Dismiss hides the band without sending a prompt', async ($, on) => {
  engine(on, 'new', { [KEY]: crashed })
  mock.clock(on, { now: 10_000_000 }) // well after the last heartbeat
  let sent = 0
  on('prompt.submit', (_$, e) => (sent++, { text: e.text }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(band)
  await ui.press({ key: 'dismiss' })
  expect(sent).toBe(0)
  expect(await (await $.ui.mount(band)).find({ key: 'dismiss' })).toBeUndefined()
})

test('turn.start writes the open checkpoint (with git); turn.complete closes it; subagent is ignored', async ($, on) => {
  const store: Record<string, unknown> = {}
  engine(on, 's1', store)
  mock.clock(on, { now: 1000 })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '## feat/x...origin/feat/x\n M a.go\n?? b.go\n', stderr: '' } }) as any)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  await $.prompt.submit({ text: 'build the feature', origin: { kind: 'composer' }, wait: false } as any)
  await $.turn.start({ text: 'build the feature', turnId: 't1' })
  const cp = store[KEY] as any
  expect(cp).toMatchObject({ open: true, sessionId: 's1', lastPrompt: 'build the feature', branch: 'feat/x', dirtyCount: 2 })
  expect(cp.dirty).toEqual([' M a.go', '?? b.go'])

  const done = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const
  await $.turn.complete({ ...done, agentId: 'sub1' })
  expect((store[KEY] as any).open).toBe(true)
  await $.turn.complete(done)
  expect((store[KEY] as any).open).toBe(false)
})

test('heartbeat every 30s refreshes lastSeen while the turn is open; stops after turn.complete', async ($, on) => {
  const store: Record<string, unknown> = {}
  engine(on, 's1', store)
  const clock = mock.clock(on, { now: 1000 })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as any)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'x', turnId: 't1' })
  await clock.advance(30_000)
  expect((store[KEY] as any).lastSeen).toBe(31_000)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(60_000)
  expect((store[KEY] as any).lastSeen).toBe(31_000)
})
