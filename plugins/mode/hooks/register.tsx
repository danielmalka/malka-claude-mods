import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {} from '../types/menu'
import type { Effort, MenuEntry } from '../types'
import { modePage } from './mode-page'
import { EFFORTS, isEffort, MODELS, prettyModel, summary } from './modes'

const effort = atom({ plugin: 'mode', key: 'effort' } as const, null)
const sessionEffort = atom({ plugin: 'mode', key: 'sessionEffort' } as const, null)
const sessionModel = atom({ plugin: 'mode', key: 'sessionModel' } as const, null)
const manual = atom({ plugin: 'mode', key: 'manual' } as const, false)
// Foreign ref: the optional `menu` mod owns it (apiVersion 1); undefined = no menu.
const menuPanel = { plugin: 'menu', key: 'panel' } as const
// Foreign ref: decision-router's own routed effort; absent plugin = null.
const routerEffort = { plugin: 'decision-router', key: 'effort' } as const
const menuEntryRef = { plugin: 'mode', key: 'menuEntry' } as const

// What the engine itself ran the last main-loop step at, to notice the user's own /effort.
let seenEffort: Effort | undefined
let seenModel: string | undefined

const PANE = 'mode-settings'
const MENU_PANE = 'mods-menu'

// Published for the optional menu; a failure here never blocks the switch itself.
async function writeEntry($: EngineInterface) {
  const entry: MenuEntry = {
    apiVersion: 1,
    title: 'Mode',
    summary: summary(await read($, sessionModel), (await read($, effort)) ?? (await read($, sessionEffort))),
    order: 3,
  }
  await $.state.set(menuEntryRef, entry).catch(() => undefined)
}

const markManual = ($: EngineInterface) => update($, manual, () => true)

// The effort every request of the main loop is sent with; null clears it. Never writes the user's /config.
async function setEffort($: EngineInterface, level: Effort | 'default') {
  const next = level === 'default' ? null : level
  await update($, effort, () => next)
  if (next === null) await $.store.delete('effort')
  else await $.store.set('effort', next)
  await markManual($)
  await writeEntry($)
  $.ui.toast(`Effort: ${level}`)
}

// Switches the session's model through Claude Code's own `/model`, so /model, the status line and the requests agree.
async function setModel($: EngineInterface, alias: string) {
  const before = await $.session.model()
  const ran = await $.command.run({ command: 'model', args: alias })
  const id = await $.session.model()
  if (id === before) {
    $.ui.toast(ran.text?.trim() || 'Model unchanged')
    return
  }
  await update($, sessionModel, () => id)
  await markManual($)
  await writeEntry($)
  $.ui.toast(`Model: ${prettyModel(id)}`)
}

// The session's own effort level before any request. First match wins: a /config row, the effortLevel setting, CLAUDE_EFFORT.
async function loadSessionEffort($: EngineInterface) {
  const found: unknown[] = []
  try {
    found.push((await $.config.list()).find(r => /effort/i.test(r.key))?.value)
  } catch {}
  try {
    found.push(((await $.settings.read()) as { effortLevel?: unknown }).effortLevel)
  } catch {}
  found.push(await $.env.get('CLAUDE_EFFORT'))
  const level = found.find(isEffort)
  if (level !== undefined) await update($, sessionEffort, () => level)
}

async function page($: EngineInterface, e: any, hasBack: boolean) {
  const tell = (what: string) => (error: unknown) => $.ui.toast(`${what}: ${String(error)}`)
  return modePage($.ui.resolve(e), {
    hasBack,
    model: await read($, sessionModel),
    level: (await read($, effort)) ?? (await read($, sessionEffort)),
    onModel: alias => setModel($, alias).catch(tell('Could not switch the model')),
    onEffort: level => setEffort($, level).catch(tell('Could not set the effort')),
    // the menu mod handles this press itself (ui.press on this plugin's key); the closure keeps the Button pressable
    onBack: () => undefined,
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Nothing is overridden until the user picks: only a stored level is read back.
    // A new session starts its own baseline: the last one's engine level is not the user's choice here.
    seenEffort = undefined
    seenModel = undefined
    await $.command
      .register({ name: 'mode', description: 'Pick the model and the reasoning effort', argumentHint: '[model <alias>|effort <level|default>]' })
      .catch(() => undefined)
    try {
      const saved = await $.store.get('effort')
      if (isEffort(saved)) await update($, effort, () => saved)
      await loadSessionEffort($).catch(() => undefined)
      await $.session.model().then(id => update($, sessionModel, () => id)).catch(() => undefined)
      await update($, manual, () => false)
      await writeEntry($)
    } catch {}
    return next(e)
  })

  on('command.run', { command: 'mode' }, async ($, e) => {
    const [what, value] = e.args.trim().toLowerCase().split(/\s+/)
    try {
      if (what === 'model') {
        if (value !== 'default' && !MODELS.some(m => m.alias === value)) return { text: `Model: ${MODELS.map(m => m.alias).join(', ')} or default.` }
        // /model cannot be run from inside a command.run hook (it would wait on this turn): run it right after.
        $.clock.after(0, () => void setModel($, value).catch(error => $.ui.toast(`Could not switch the model: ${String(error)}`)))
        return { text: `Switching the model to ${value}.` }
      }
      if (what === 'effort') {
        if (value !== 'default' && !isEffort(value)) return { text: `Effort: ${EFFORTS.join(', ')} or default.` }
        await setEffort($, value as Effort | 'default')
        return { text: `Effort: ${value}.` }
      }
    } catch (error) {
      return { text: `Mode could not be changed: ${String(error)}` }
    }
    await $.ui.open({ id: PANE, title: 'Mode', focus: true, closeOnEscape: true, rows: 18, columns: 48 })
    return { text: 'Mode settings are open.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => page($, e, false))

  // Inside the menu's pane (apiVersion 1): drawn only when the menu is on this panel.
  on('ui.render', { component: 'Pane', requestId: MENU_PANE }, async ($, e, next) => {
    const { value } = await $.state.get(menuPanel)
    if (value !== 'mode') return next(e)
    return page($, e, true)
  })

  // The chosen effort rides on every model request of the main loop; unset = the request goes down untouched.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    let level: Effort | null = null
    try {
      level = await read($, effort)
    } catch {}
    // A level the router put on this step is not the engine's: do not mistake it for the user's /effort.
    let routed: unknown = null
    try {
      routed = (await $.state.get(routerEffort)).value
    } catch {}
    const engineEffort = routed !== null && e.effort === routed ? undefined : e.effort
    // The session's own level and model, as the engine had them, before ours replaces the level.
    let changed = false
    // The engine's level moved on the same model since the last step: the user ran /effort or /config.
    // That is a newer choice than our override, so ours is dropped.
    if (e.model !== seenModel) seenEffort = undefined
    seenModel = e.model
    if (isEffort(engineEffort)) {
      if (level !== null && seenEffort !== undefined && engineEffort !== seenEffort) {
        level = null
        await update($, effort, () => null).catch(() => undefined)
        await $.store.delete('effort').catch(() => undefined)
        $.ui.toast(`Effort: following your /effort ${engineEffort}`)
        changed = true
      }
      seenEffort = engineEffort
    }
    if (isEffort(engineEffort) && engineEffort !== (await read($, sessionEffort).catch(() => null))) {
      await update($, sessionEffort, () => engineEffort).catch(() => undefined)
      changed = true
    }
    if (e.model !== (await read($, sessionModel).catch(() => null))) {
      await update($, sessionModel, () => e.model).catch(() => undefined)
      changed = true
    }
    if (changed) await writeEntry($)
    return yield* next(level !== null && e.effort !== undefined ? { ...e, effort: level } : e)
  })
}
