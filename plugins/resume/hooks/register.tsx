import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ResumeCrash } from '../types'

const crash = atom({ plugin: 'resume', key: 'crash' } as const, null)

type Checkpoint = Omit<ResumeCrash, 'at'> & { open: boolean; startedAt: number; lastSeen: number }

const key = (cwd: string) => `resume:${cwd}`
const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const oneLine = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n)

let lastPrompt = ''
let interactive = false // non-interactive runs (claude -p) do not write a checkpoint
let beat: { cancel: () => void } | undefined
// ponytail: a 30s heartbeat tells "another live session in the same cwd" from "crashed"; a restart within 90s goes unnoticed
const BEAT_MS = 30_000
const ALIVE_MS = 90_000

async function save($: EngineInterface, patch: Partial<Checkpoint>) {
  if (!interactive) return
  const cwd = await $.session.cwd()
  const old = (await $.store.get(key(cwd))) as Checkpoint | undefined
  // only activity from an open turn of this session (another session in the same cwd may have overwritten it)
  if (patch.open === undefined && (!old?.open || old.sessionId !== (await $.session.id()))) return
  await $.store.set(key(cwd), { ...old, ...patch, cwd })
}

// ponytail: a single `git status --porcelain --branch`; no git or an error = no branch and no files.
async function gitState($: EngineInterface, cwd: string) {
  try {
    const r = await $.process.run(['git', '-C', cwd, 'status', '--porcelain', '--branch'])
    if (r.exitCode !== 0) return {}
    const [head = '', ...files] = r.stdout.split('\n').filter(Boolean)
    const branch = head.replace(/^## (No commits yet on )?/, '').split(/\.\.\.| /)[0]
    return { branch, dirty: files.slice(0, 10), dirtyCount: files.length }
  } catch {
    return {}
  }
}

async function clear($: EngineInterface, cwd: string) {
  await $.store.delete(key(cwd))
  await update($, crash, () => null)
}

function resumePrompt(c: ResumeCrash) {
  const files = c.dirty.length > 0 ? `\nChanged files (${c.dirtyCount}):\n${c.dirty.join('\n')}` : ''
  return (
    `The previous session was interrupted at ${hhmm(c.at)}.\n` +
    `Last request: "${c.lastPrompt}"\n` +
    (c.branch ? `Branch: ${c.branch}\n` : '') +
    `${files}\n\n` +
    'Check the actual state before acting: git status and git log, and any project notes or handoff files. ' +
    'Then continue where it left off, without redoing what is already done.'
  )
}

export const register: Register = on => {
  on('prompt.submit', ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge' || e.origin.kind === 'sdk') {
      lastPrompt = e.text.trim().slice(0, 300)
    }
    return next(e)
  })

  // turn.start is only raised by the main loop: a subagent turn does not raise it.
  on('turn.start', async ($, e, next) => {
    const cwd = await $.session.cwd()
    const now = await $.clock.now()
    await save($, {
      open: true,
      sessionId: await $.session.id(),
      startedAt: now,
      lastSeen: now,
      lastPrompt: lastPrompt || oneLine(e.text, 300),
      dirty: [],
      dirtyCount: 0,
      ...(await gitState($, cwd)),
    })
    beat ??= $.clock.every(BEAT_MS, async () => save($, { lastSeen: await $.clock.now() }))
    return next(e)
  })

  // pulse: the "interruption time" is the last activity seen, not the turn start.
  on('tool.call', async ($, e, next) => {
    await save($, { lastSeen: await $.clock.now() })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      beat?.cancel()
      beat = undefined
      await save($, { open: false })
    }
    return next(e)
  })

  // session.start does not carry the origin (startup/resume/reload): what separates an interruption from a reload is the sessionId.
  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive
    if (e.isInteractive) {
      const old = (await $.store.get(key(e.cwd))) as Checkpoint | undefined
      const isAlive = old !== undefined && (await $.clock.now()) - old.lastSeen < ALIVE_MS
      if (old?.open && !isAlive && old.sessionId !== (await $.session.id())) {
        await update($, crash, () => ({ ...old, at: old.lastSeen }))
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await read($, crash)
    if (e.props.hasSurvey || c === null) return next(e)

    const files = c.branch === undefined ? '' : ` · ${c.dirtyCount} changed files`
    const text = `⚠ The previous session was interrupted at ${hhmm(c.at)} during: "${oneLine(c.lastPrompt, 60)}" · ${c.branch ?? 'no git'}${files}`
    const under = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {under}
        <Box>
          <Text wrap="truncate-end">{text.slice(0, Math.max(10, e.props.bodyColumns - 24))} </Text>
          <Button
            key="resume"
            label="Resume"
            variant="primary"
            onPress={async () => {
              await clear($, c.cwd)
              void $.prompt.submit({ text: resumePrompt(c) })
            }}
          />
          <Text> </Text>
          <Button key="dismiss" label="Dismiss" onPress={() => clear($, c.cwd)} />
        </Box>
      </Box>
    )
  })
}
