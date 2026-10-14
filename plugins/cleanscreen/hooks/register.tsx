import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type {} from '../types/menu'
import type { CleanColors, CleanTheme, MenuEntry } from '../types'
import { cleanBand } from './band'
import {
  addStep, colorsFor, contextFor, DEFAULT_CUSTOM, HEX, parseInput, percentOf, PROMPT, THEMES, todoSteps, TOOL, TOOL_DESCRIPTION,
  TOOL_NAME, TOOL_SCHEMA, updateSteps,
} from './clean'
import { cleanPage } from './page'

const isOnAtom = atom({ plugin: 'cleanscreen', key: 'isOn' } as const, false)
const themeAtom = atom({ plugin: 'cleanscreen', key: 'theme' } as const, 'blue')
const customAtom = atom({ plugin: 'cleanscreen', key: 'custom' } as const, DEFAULT_CUSTOM)
const collapsedAtom = atom({ plugin: 'cleanscreen', key: 'isCollapsed' } as const, false)
const taskAtom = atom({ plugin: 'cleanscreen', key: 'task' } as const, null)
const clockAtom = atom({ plugin: 'cleanscreen', key: 'clock' } as const, 0)
// Foreign ref: the optional `menu` mod owns it (apiVersion 1); undefined = no menu.
const menuPanel = { plugin: 'menu', key: 'panel' } as const
const menuEntryRef = { plugin: 'cleanscreen', key: 'menuEntry' } as const

const PANE = 'cleanscreen-settings'
const MENU_PANE = 'mods-menu'

let ticker: Timer | undefined
const stopTicker = () => {
  ticker?.cancel()
  ticker = undefined
}

const writeEntry = async ($: EngineInterface) => {
  const isOn = await read($, isOnAtom)
  const entry: MenuEntry = { apiVersion: 1, title: 'Clean screen', summary: isOn ? `on · ${await read($, themeAtom)} band` : 'off', order: 2 }
  await $.state.set(menuEntryRef, entry)
}

// The model can only see the tool once registered, and the API has no way to take it back: it is registered
// only while on (at session start or when turned on), never while off.
const exposeTool = ($: EngineInterface) =>
  $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA }).then(() => undefined, () => undefined)

async function finishTask($: EngineInterface) {
  try {
    stopTicker()
    const t = await read($, taskAtom)
    if (t && t.doneAt === null) {
      const doneAt = await $.clock.now()
      await update($, taskAtom, c => (c ? { ...c, doneAt } : c))
      await update($, clockAtom, () => doneAt)
      $.clock.after(8000, () => {
        void update($, taskAtom, c => (c && c.doneAt === doneAt ? null : c))
      })
    }
  } catch {}
}

async function setOn($: EngineInterface, isOn: boolean) {
  await update($, isOnAtom, () => isOn)
  await $.store.set('isOn', isOn)
  if (isOn) await exposeTool($)
  else {
    stopTicker()
    await update($, taskAtom, () => null)
  }
  await writeEntry($)
}

async function setTheme($: EngineInterface, theme: CleanTheme) {
  await update($, themeAtom, () => theme)
  await $.store.set('theme', theme)
  await writeEntry($)
}

// Returns an error text, or undefined when the color was set.
async function setColor($: EngineInterface, part: keyof CleanColors, value: string) {
  if (!HEX.test(value.trim())) {
    const text = `${value} is not a hex color like #3b82f6`
    $.ui.toast(text)
    return text
  }
  const colors = await update($, customAtom, c => ({ ...c, [part]: value.trim() }))
  await $.store.set('custom', colors)
  return undefined
}

const noop = () => undefined

async function page($: EngineInterface, e: any, hasBack: boolean) {
  return cleanPage($.ui.resolve(e), {
    isOn: await read($, isOnAtom),
    theme: await read($, themeAtom),
    custom: await read($, customAtom),
    hasBack,
    onOn: v => void setOn($, v).catch(() => undefined),
    onTheme: t => void setTheme($, t).catch(() => undefined),
    onColor: (part, value) => void setColor($, part, value).catch(() => undefined),
    onBack: noop, // the menu mod handles this press itself (ui.press on mods-back)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      // Default off: only a stored "on" turns it on.
      const isOn = (await $.store.get('isOn')) === true
      const theme = (await $.store.get('theme')) as CleanTheme | undefined
      const custom = (await $.store.get('custom')) as CleanColors | undefined
      stopTicker()
      await update($, taskAtom, () => null)
      await update($, collapsedAtom, () => false)
      await update($, isOnAtom, () => isOn)
      if (theme !== undefined && THEMES.includes(theme)) await update($, themeAtom, () => theme)
      if (custom !== undefined && HEX.test(custom.bar) && HEX.test(custom.text) && HEX.test(custom.border)) await update($, customAtom, () => custom)
      if (isOn) await exposeTool($)
      await writeEntry($)
      await $.command
        .register({ name: 'cleanscreen', description: 'Clean screen: hide tool calls, show a progress band', argumentHint: '[on|off|theme <name>|color <bar|text|border> <#hex>]' })
        .catch(() => undefined)
    } catch {}
    return next(e)
  })

  on('command.run', { command: 'cleanscreen' }, async ($, e) => {
    const [cmd = '', a1 = '', a2 = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (cmd === 'on' || cmd === 'off') {
      await setOn($, cmd === 'on')
      return { text: `Clean screen is ${cmd}.` }
    }
    if (cmd === 'theme') {
      if (!THEMES.includes(a1 as CleanTheme)) return { text: `Themes: ${THEMES.join(', ')}.` }
      await setTheme($, a1 as CleanTheme)
      return { text: `Clean screen theme is ${a1}.` }
    }
    if (cmd === 'color') {
      if (a1 !== 'bar' && a1 !== 'text' && a1 !== 'border') return { text: 'Usage: /cleanscreen color <bar|text|border> <#rrggbb>' }
      const bad = await setColor($, a1, a2)
      return { text: bad ?? `Custom ${a1} color is ${a2}. Use /cleanscreen theme custom to show it.` }
    }
    await $.ui.open({ id: PANE, title: 'Clean screen', focus: true, closeOnEscape: true, rows: 22, columns: 56 })
    return { text: 'Clean screen settings are open.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => page($, e, false))

  // Inside the menu's pane (apiVersion 1): drawn only when the menu is on this panel.
  on('ui.render', { component: 'Pane', requestId: MENU_PANE }, async ($, e, next) => {
    const { value } = await $.state.get(menuPanel)
    if (value !== 'cleanscreen') return next(e)
    return page($, e, true)
  })

  // The band above the prompt. A failure draws nothing of ours.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.props.hasSurvey) return next(e)
      const t = await read($, taskAtom)
      if (!(await read($, isOnAtom)) || t === null) return next(e)
      const theme = await read($, themeAtom)
      return cleanBand($.ui.resolve(e), {
        t,
        theme,
        colors: colorsFor(theme, await read($, customAtom)),
        isCollapsed: await read($, collapsedAtom),
        clock: await read($, clockAtom),
        columns: Math.max(30, e.props.bodyColumns ?? 80),
        onToggle: () => update($, collapsedAtom, c => !c),
      })
    } catch {
      return next(e)
    }
  })

  // Tool rows draw nothing while it is on, except a call that errored, was refused or was interrupted.
  for (const component of ['ToolUse', 'ToolResult', 'ToolGroup', 'ToolProgress'] as const) {
    on('ui.render', { component }, async ($, e, next) => {
      let hide = false
      try {
        const p = e.props as any
        const problem =
          p.isErrored === true || p.isInterrupted === true || (Array.isArray(p.calls) && p.calls.some((c: any) => c.isErrored === true || c.isInterrupted === true))
        hide = !problem && (await read($, isOnAtom))
      } catch {}
      return hide ? $.ui.resolve(e).Box({ display: 'none' }) : next(e)
    })
  }

  // A typed prompt starts the band's task and carries the instructions; nothing is added while off. Any error: the prompt goes on unchanged.
  on('prompt.submit', async ($, e, next) => {
    try {
      const context = contextFor(e.origin?.kind, e.text, await read($, isOnAtom))
      if (context.length === 0) return next(e)
      const startedAt = await $.clock.now()
      const title = (String(e.text).trim().split('\n')[0] ?? '').slice(0, 200)
      await update($, taskAtom, () => ({ title, startedAt, doneAt: null, steps: [] }))
      await update($, clockAtom, () => startedAt)
      stopTicker()
      ticker = $.clock.every(1000, () => {
        void $.clock.now().then(t => update($, clockAtom, () => t))
      })
      return next({ ...e, context: [...(e.context ?? []), ...context] })
    } catch {
      return next(e)
    }
  })

  // The turn ending, or being interrupted, marks the task done; the band clears a moment later.
  on('turn.complete', async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      if (!e.agentId) await finishTask($)
    }
  })
  on('turn.abort', async ($, e, next) => {
    await finishTask($)
    return next(e)
  })

  // The model's progress tool. Each call sends the whole step list. Fail-open: a state error answers with a plain result.
  on('tool.call', { tool: TOOL }, async ($, e) => {
    try {
      if (!(await read($, isOnAtom))) return { result: 'Clean screen is off; the progress band is not shown.' }
      const { title, steps } = parseInput(e)
      // ponytail: a task begun by this call has no elapsed-time ticker (a typed prompt starts that one).
      const current = await read($, taskAtom)
      if (current === null || current.doneAt !== null) {
        const startedAt = await $.clock.now()
        await update($, taskAtom, () => ({ title: 'Working', startedAt, doneAt: null, steps: [] }))
        await update($, clockAtom, () => startedAt)
      }
      await update($, taskAtom, t => (t === null ? t : { ...t, title: title || t.title, steps }))
      const t = await read($, taskAtom)
      const done = steps.filter(s => s.status === 'completed').length
      return { result: `Progress band updated: ${done} of ${steps.length} steps done (${t === null ? 0 : percentOf(t)}%).` }
    } catch {
      return { result: 'Progress band unavailable.' }
    }
  })

  // The three below only follow the tool's input or result: a state error is dropped, the call itself goes on once.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    try {
      await update($, taskAtom, t => (t === null ? t : { ...t, steps: todoSteps(e.todos) }))
    } catch {}
    return next(e)
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      const id = (ran.result as { task?: { id?: string } } | undefined)?.task?.id
      if (id !== undefined) await update($, taskAtom, t => (t === null ? t : { ...t, steps: addStep(t.steps, id, e.subject) }))
    } catch {}
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    try {
      await update($, taskAtom, t => (t === null ? t : { ...t, steps: updateSteps(t.steps, e) }))
    } catch {}
    return ran
  })
}
