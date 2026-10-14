import type { EngineInterface, Register } from 'claude-code'

const STALL_MS = 5 * 60_000 // no activity for this long = stalled
const TICK_MS = 15_000
const LINGER_MS = 60_000 // how long a finished item stays in the band

// ponytail: no $.state; a hot reload clears the list (timers drop too).
type Item = {
  label: string
  isAgent: boolean // only a subagent has observable activity (turn.step / tool.call)
  start: number
  last: number
  doneAt?: number
  warned?: boolean
}

const mins = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`)

const items = new Map<string, Item>()
let timer: { cancel: () => void } | undefined
let batchStart = 0
let batchCount = 0

const running = () => [...items.values()].filter(i => i.doneAt === undefined)

async function add($: EngineInterface, id: string, label: string, isAgent: boolean) {
  const now = await $.clock.now()
  if (running().length === 0) {
    batchStart = now
    batchCount = 0
  }
  batchCount += 1
  items.set(id, { label, isAgent, start: now, last: now })
  timer ??= $.clock.every(TICK_MS, async () => {
    const t = await $.clock.now()
    for (const i of running()) {
      if (i.isAgent && !i.warned && t - i.last > STALL_MS) {
        i.warned = true
        $.ui.toast(`sentinel: ${i.label} stalled for ${mins(t - i.last)}`)
      }
    }
    if (running().length === 0) {
      timer?.cancel()
      timer = undefined
    }
    $.ui.invalidate('ui.render')
  })
  $.ui.invalidate('ui.render')
}

async function finish($: EngineInterface, id: string) {
  const item = items.get(id)
  if (!item || item.doneAt !== undefined) return
  const now = await $.clock.now()
  item.doneAt = now
  if (running().length === 0) {
    timer?.cancel()
    timer = undefined
    $.ui.toast(`sentinel: all done (${batchCount} tasks, ${mins(now - batchStart)})`)
  }
  $.clock.after(LINGER_MS + 500, () => $.ui.invalidate('ui.render'))
  $.ui.invalidate('ui.render')
}

async function touch($: EngineInterface, id?: string) {
  const item = id === undefined ? undefined : items.get(id)
  if (item && item.doneAt === undefined) item.last = await $.clock.now()
}

export const register: Register = on => {
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId !== undefined && !e.isTeammate) {
      await add($, r.agentId, e.description || e.subagentType, true)
    }
    return r
  })

  on('turn.step', async function* ($, e, next) {
    await touch($, e.agentId)
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) await finish($, e.agentId)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await touch($, e.agentId)
    const ran = await next(e)
    if (e.tool === 'Bash' && ran.deny === undefined) {
      const id = (ran.result as { backgroundTaskId?: string }).backgroundTaskId
      if (id) await add($, id, e.command.slice(0, 30), false)
    }
    return ran
  })

  // End of background Bash: the task notification comes back as a prompt (task-notification).
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(e.text)?.[1]
      if (id) await finish($, id)
    }
    return next(e)
  })

  // Same signal, via the notification line in the transcript (structured props.task).
  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'task-notification' } } }, async ($, e, next) => {
    const id = (e.props as { task?: { id?: string } }).task?.id
    if (id) await finish($, id)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await $.clock.now()
    const live = running()
    const recent = [...items.values()].filter(i => i.doneAt !== undefined && now - i.doneAt < LINGER_MS)
    if (e.props.hasSurvey || live.length + recent.length === 0) return next(e)

    const parts = live.map(i => {
      const quiet = now - i.last
      if (!i.isAgent) return `${i.label} ${mins(now - i.start)}`
      if (quiet > STALL_MS) return `${i.label} ${mins(now - i.start)} ⚠ stalled for ${mins(quiet)}`
      return `${i.label} ${mins(now - i.start)} (active ${mins(quiet)} ago)`
    })
    const head = live.length > 0 ? `⏳ ${live.length} running` : '✓ done'
    const done = recent.map(i => `✓ ${i.label} ${mins(i.doneAt! - i.start)}`)
    const line = [head, ...parts, ...done].join(' · ').slice(0, e.props.bodyColumns)

    const under = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {under}
        <Text wrap="truncate-end">{line}</Text>
      </Box>
    )
  })
}
