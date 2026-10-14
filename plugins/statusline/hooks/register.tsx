import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type {} from '../types/menu'
import type { MenuEntry, StatusSnapshot } from '../types'
import { configDir, moveStatusLine, parseSettings, type Settings } from './settings'
import { LIMIT_LABELS } from './status'
import { statusPage, statusRow } from './status-line'

const isOnAtom = atom({ plugin: 'statusline', key: 'isOn' } as const, false)
const snapshotAtom = atom({ plugin: 'statusline', key: 'snapshot' } as const, null)
const lastResponseAt = atom({ plugin: 'statusline', key: 'lastResponseAt' } as const, null)
const clockAtom = atom({ plugin: 'statusline', key: 'clock' } as const, 0)
// Foreign refs: the optional `menu` mod owns them (apiVersion 1); undefined = no menu.
const menuPanel = { plugin: 'menu', key: 'panel' } as const
const menuPresent = { plugin: 'menu', key: 'present' } as const
const menuEntryRef = { plugin: 'statusline', key: 'menuEntry' } as const

const PANE = 'statusline-settings'
const MENU_PANE = 'mods-menu'
const BRANCH_MS = 5_000
const TICK_MS = 15_000

// ~/.claude/settings.json ----------------------------------------------------------------
// Parsed first, so an invalid file is never overwritten; the first change keeps the original text in settings.json.statusline.bak.

async function settingsPath($: EngineInterface) {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  return `${configDir(await $.env.get('CLAUDE_CONFIG_DIR'), home)}/settings.json`
}

// Moves and mode changes run one at a time: two quick presses cannot interleave their file writes.
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(job: () => Promise<T>): Promise<T> {
  const result = queue.then(job)
  queue = result.catch(() => undefined)
  return result
}

// On: the user's own statusLine is kept (plugin store and the .bak) and taken out of settings.json; off puts it back.
// The latest statusLine the user set wins; a saved one it supersedes is appended to settings.json.statusline.prev.bak
// ({ history: [{ statusLine, at }] }, never truncated).
async function moveNow($: EngineInterface, isOn: boolean) {
  const path = await settingsPath($)
  const existed = await $.fs.exists(path)
  const text = existed ? ((await $.fs.read(path)) as string) : '{}'
  const settings: Settings = parseSettings(text)
  const saved = (await $.store.get('savedStatusLine')) as { statusLine: unknown } | undefined
  const moved = moveStatusLine(settings, isOn, saved)
  if (moved === undefined) return
  // the safe copies first, the settings.json write last: a failure never loses the user's value
  if (moved.prev !== undefined) {
    const prevPath = `${path}.statusline.prev.bak`
    const old = (await $.fs.exists(prevPath)) ? parseSettings((await $.fs.read(prevPath)) as string) : {}
    const history: { statusLine: unknown; at: string }[] = Array.isArray(old.history) ? old.history : []
    if (JSON.stringify(history[history.length - 1]?.statusLine) !== JSON.stringify(moved.prev)) {
      history.push({ statusLine: moved.prev, at: new Date(await $.clock.now()).toISOString() })
      await $.fs.write(prevPath, `${JSON.stringify({ history }, null, 2)}\n`)
    }
    $.ui.toast(`Your earlier saved statusLine was kept in ${prevPath} (${history.length} ${history.length === 1 ? 'entry' : 'entries'})`)
  }
  if (moved.save !== undefined) await $.store.set('savedStatusLine', moved.save)
  const backup = `${path}.statusline.bak`
  if (existed && !(await $.fs.exists(backup))) await $.fs.write(backup, text)
  if (moved.next !== settings) await $.fs.write(path, `${JSON.stringify(moved.next, null, 2)}\n`)
  if (moved.drop) await $.store.delete('savedStatusLine')
}

const moveUserStatusLine = ($: EngineInterface, isOn: boolean) => serial(() => moveNow($, isOn))

// Status data ---------------------------------------------------------------------------

// The git branch is looked up at most once per BRANCH_MS (and when the folder changes).
let branchAt = 0
let branchCwd = ''
let branch = ''
let ticker: Timer | undefined

async function refreshStatus($: EngineInterface, force = false) {
  const [model, cwd, usage] = await Promise.all([$.session.model(), $.session.cwd(), $.session.usage()])
  if (force || cwd !== branchCwd || Date.now() - branchAt >= BRANCH_MS) {
    branchAt = Date.now()
    branchCwd = cwd
    branch = ''
    try {
      const ran = await $.process.run(['git', '-C', cwd, 'branch', '--show-current'])
      if (ran.exitCode === 0) branch = ran.stdout.trim()
    } catch {}
  }
  const snapshot: StatusSnapshot = {
    model,
    dir: cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd,
    branch,
    ctxPercent: usage.context.percent ?? null,
    ctxTokens: usage.context.tokens ?? null,
    ctxWindow: usage.context.window,
    limits: usage.rateLimits
      .filter(l => LIMIT_LABELS[l.kind] !== undefined)
      .map(l => ({
        label: LIMIT_LABELS[l.kind]!,
        percent: Math.round(l.percentUsed),
        resetsAt: l.resetsAt === undefined ? null : Date.parse(l.resetsAt),
      })),
  }
  // nothing drawn changed: no write, no redraw
  if (JSON.stringify(await read($, snapshotAtom)) !== JSON.stringify(snapshot)) await update($, snapshotAtom, () => snapshot)
}

const writeEntry = ($: EngineInterface, isOn: boolean) => {
  const entry: MenuEntry = { apiVersion: 1, title: 'Status line', summary: isOn ? 'on' : 'off', order: 1 }
  return $.state.set(menuEntryRef, entry)
}

function runTicker($: EngineInterface, isOn: boolean) {
  ticker?.cancel()
  ticker = undefined
  if (!isOn) return
  try {
    ticker = $.clock.every(TICK_MS, () => {
      void update($, clockAtom, () => Date.now())
      void refreshStatus($).catch(() => undefined) // branch lookups are throttled by BRANCH_MS
    })
  } catch {}
}

async function setOnNow($: EngineInterface, isOn: boolean) {
  // The mode is persisted before the move: a crash in between is repaired at the next session start.
  const was = (await $.store.get('isOn')) === true
  await $.store.set('isOn', isOn)
  try {
    await moveNow($, isOn)
  } catch (error) {
    await $.store.set('isOn', was)
    throw error
  }
  // summary 'on' implies the footer is ours: turning on flips the mode first, turning off writes the entry first
  if (isOn) await update($, isOnAtom, () => true)
  await writeEntry($, isOn)
  if (!isOn) await update($, isOnAtom, () => false)
  runTicker($, isOn)
  if (isOn) {
    await update($, clockAtom, () => Date.now())
    await refreshStatus($, true)
  }
}

const setOn = ($: EngineInterface, isOn: boolean) => serial(() => setOnNow($, isOn))

// The menu mod handles these presses itself (ui.press on this plugin's key); the closure only keeps the Button pressable.
// The engine's hint on one row: it can carry a second line holding only a separator.
const hintText = (hint: string) =>
  hint
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /[\p{L}\p{N}]/u.test(line))
    .join(' · ')

const noop = () => undefined

const tell = ($: EngineInterface) => (error: unknown) => $.ui.toast(`Status line: ${String(error)}`)

async function page($: EngineInterface, e: any, hasBack: boolean) {
  return statusPage($.ui.resolve(e), {
    isOn: await read($, isOnAtom),
    hasBack,
    onSet: v => setOn($, v).catch(tell($)),
    onBack: noop,
  })
}

const openTasks = async ($: EngineInterface) => {
  try {
    await $.command.run({ command: 'tasks' })
  } catch (error) {
    $.ui.toast(`Could not open /tasks: ${String(error)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Default off: only a stored "on" turns it on.
    const isOn = (await $.store.get('isOn')) === true
    await update($, isOnAtom, () => isOn)
    await writeEntry($, isOn)
    await update($, clockAtom, () => Date.now())
    runTicker($, isOn)
    // a statusLine back in settings.json (edited while off the mod's watch) must not draw under our row
    // off with a saved value: a crash left it unrestored (or a newer statusLine supersedes it)
    if (isOn || (await $.store.get('savedStatusLine')) !== undefined) await moveUserStatusLine($, isOn).catch(tell($))
    if (isOn) await refreshStatus($, true).catch(() => undefined)
    await $.command
      .register({ name: 'statusline', description: 'Turn the status line on or off, or open its settings', argumentHint: '[on|off]' })
      .catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'statusline' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      try {
        await setOn($, arg === 'on')
        return { text: `Status line is ${arg}.` }
      } catch (error) {
        return { text: `Status line could not be turned ${arg}: ${String(error)}` }
      }
    }
    await $.ui.open({ id: PANE, title: 'Status line', focus: true, closeOnEscape: true, rows: 14, columns: 56 })
    return { text: 'Status line settings are open.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => page($, e, false))

  // Inside the menu's pane (apiVersion 1): drawn only when the menu is on this panel.
  on('ui.render', { component: 'Pane', requestId: MENU_PANE }, async ($, e, next) => {
    const { value } = await $.state.get(menuPanel)
    if (value !== 'statusline') return next(e)
    return page($, e, true)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!(await read($, isOnAtom))) return next(e)
    const snapshot = await read($, snapshotAtom)
    const ui = $.ui.resolve(e)
    const { value: hasMenu } = await $.state.get(menuPresent)
    const label = '◆ mods'
    const button = hasMenu === true ? <ui.Button key="mods-open" plain label={label} onPress={noop} /> : undefined
    // No snapshot yet (or it keeps failing): the engine's hint row, so the footer and the button never vanish.
    if (snapshot === null) {
      return (
        <ui.Box justifyContent="space-between" flexGrow={1} gap={1}>
          <ui.Text dimColor wrap="truncate">
            {hintText(e.props.hint)}
          </ui.Text>
          {button ?? null}
        </ui.Box>
      )
    }
    return statusRow(ui, {
      snapshot,
      clock: await read($, clockAtom),
      lastResponseAt: await read($, lastResponseAt),
      columns: e.viewport?.columns ?? 120,
      label: button === undefined ? '' : label,
      hint: e.props.hint,
      button,
      onPill: () => openTasks($),
    })
  })

  // The main loop's responses keep the prompt cache warm; subagents' do not.
  on('turn.step', async function* ($, e, next) {
    const answered = yield* next(e)
    if (e.agentId === undefined && answered.usage !== null && (await read($, isOnAtom).catch(() => false))) {
      const at = Date.now()
      await update($, lastResponseAt, () => at).catch(() => undefined)
      await update($, clockAtom, () => at).catch(() => undefined)
      void refreshStatus($).catch(() => undefined)
    }
    return answered
  })
}
