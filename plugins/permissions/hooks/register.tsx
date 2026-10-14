import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {} from '../types/menu'
import type { MenuEntry } from '../types'
import { isMode, MODES, modeLabel, type Mode } from './modes'
import { BYPASS_WARNING, permissionsPage } from './permissions-page'
import { configDir, currentDefault, parseSettings, why, withDefaultMode, type Settings } from './settings'

const defaultModeAtom = atom({ plugin: 'permissions', key: 'defaultMode' } as const, 'default')
// Foreign ref: the optional `menu` mod owns it (apiVersion 1); undefined = no menu.
const menuPanel = { plugin: 'menu', key: 'panel' } as const
const menuEntryRef = { plugin: 'permissions', key: 'menuEntry' } as const

const PANE = 'permissions-settings'
const MENU_PANE = 'mods-menu'

// ~/.claude/settings.json ----------------------------------------------------------------
// Parsed first, so an invalid file is never overwritten. The first change keeps the original text in
// settings.json.permissions.bak; a defaultMode a pick supersedes is appended to settings.json.permissions.prev.bak.

async function settingsPath($: EngineInterface) {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  return `${configDir(await $.env.get('CLAUDE_CONFIG_DIR'), home)}/settings.json`
}

// Two quick presses cannot interleave their file writes.
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(job: () => Promise<T>): Promise<T> {
  const result = queue.then(job)
  queue = result.catch(() => undefined)
  return result
}

async function writeDefaultMode($: EngineInterface, mode: Mode) {
  const path = await settingsPath($)
  const existed = await $.fs.exists(path)
  const text = existed ? ((await $.fs.read(path)) as string) : '{}'
  const settings: Settings = parseSettings(text)
  const next = withDefaultMode(settings, mode)
  const prev = currentDefault(settings)
  if ((prev ?? 'default') === mode) return // already the default (an absent key means default): nothing to write, no backup
  // the safe copies first, the settings.json write last: a failure never loses the user's value
  if (prev !== undefined && prev !== mode) {
    const prevPath = `${path}.permissions.prev.bak`
    const old = (await $.fs.exists(prevPath)) ? parseSettings((await $.fs.read(prevPath)) as string, 'the permissions history file') : {}
    const history: { defaultMode: string; at: string }[] = Array.isArray(old.history) ? old.history : []
    history.push({ defaultMode: prev, at: new Date(await $.clock.now()).toISOString() })
    await $.fs.write(prevPath, `${JSON.stringify({ history }, null, 2)}\n`)
  }
  const backup = `${path}.permissions.bak`
  if (existed && !(await $.fs.exists(backup))) await $.fs.write(backup, text)
  await $.fs.write(path, `${JSON.stringify(next, null, 2)}\n`)
}

// permissions.defaultMode: the mode new sessions start in. A running session's mode is shift+tab's; a mod cannot set it.
async function setDefaultMode($: EngineInterface, mode: Mode) {
  await serial(() => writeDefaultMode($, mode))
  await update($, defaultModeAtom, () => mode)
  await writeEntry($)
  $.ui.toast(`New sessions start in ${modeLabel(mode)} mode${mode === 'bypassPermissions' ? `. ${BYPASS_WARNING}` : ''}`)
}

// Published for the optional menu; a failure here never blocks the pick itself.
async function writeEntry($: EngineInterface) {
  const entry: MenuEntry = { apiVersion: 1, title: 'Permissions', summary: `new sessions: ${modeLabel(await read($, defaultModeAtom))}`, order: 4 }
  await $.state.set(menuEntryRef, entry).catch(() => undefined)
}

// The user's file value, the one the writes go to: always current. Pure (a render hook may call it).
async function fileDefault($: EngineInterface): Promise<string> {
  const path = await settingsPath($)
  const settings = (await $.fs.exists(path)) ? parseSettings((await $.fs.read(path)) as string) : {}
  return currentDefault(settings) ?? 'default'
}

// Into the atom (the menu entry reads it); when the file cannot be read the atom keeps its value.
const loadDefault = ($: EngineInterface) => fileDefault($).then(value => update($, defaultModeAtom, () => value)).catch(() => undefined)

async function page($: EngineInterface, e: any, hasBack: boolean) {
  // the file may have changed since session.start (an edit, another session): re-read on every draw
  const defaultMode = await fileDefault($).catch(() => read($, defaultModeAtom))
  return permissionsPage($.ui.resolve(e), {
    hasBack,
    defaultMode,
    onMode: mode => setDefaultMode($, mode).catch(error => $.ui.toast(`Could not set the default mode: ${why(error)}`)),
    // the menu mod handles this press itself (ui.press on this plugin's key); the closure keeps the Button pressable
    onBack: () => undefined,
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Nothing is written until the user picks: only the current value is read.
    await loadDefault($)
    await writeEntry($)
    await $.command
      .register({ name: 'permmode', description: 'Show the permission mode and pick the one new sessions start in', argumentHint: `[${MODES.join('|')}]` })
      .catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'permmode' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg !== '') {
      if (!isMode(arg)) return { text: `Usage: /permmode [${MODES.join('|')}]` }
      // The command may be invoked by the model: the mode that skips every check is a human pick, in the pane.
      if (arg === 'bypassPermissions') return { text: 'bypassPermissions can only be picked in the pane; open it with /permmode.' }
      try {
        await setDefaultMode($, arg)
        return { text: `New sessions start in ${modeLabel(arg)} mode.` }
      } catch (error) {
        return { text: `The default mode could not be changed: ${why(error)}` }
      }
    }
    await $.ui.open({ id: PANE, title: 'Permissions', focus: true, closeOnEscape: true, rows: 17, columns: 56 })
    return { text: 'Permission settings are open.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => page($, e, false))

  // Inside the menu's pane (apiVersion 1): drawn only when the menu is on this panel.
  on('ui.render', { component: 'Pane', requestId: MENU_PANE }, async ($, e, next) => {
    const { value } = await $.state.get(menuPanel)
    if (value !== 'permissions') return next(e)
    return page($, e, true)
  })
}
