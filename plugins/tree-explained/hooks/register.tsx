import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type {} from '../types/menu'
import type { Entry, MenuEntry } from '../types'
import { treePage, settingsPage } from './page'
import { buildRequest, change, cleanLang, cleanReply, fallbackSummary, MAX_SUMMARIES, newPending, record } from './summary'
import type { Change } from './summary'
import { buildRows, cleanText, relPath, touch } from './tree'

const isOnAtom = atom({ plugin: 'tree-explained', key: 'isOn' } as const, false)
const filesAtom = atom({ plugin: 'tree-explained', key: 'files' } as const, {})
const inflightAtom = atom({ plugin: 'tree-explained', key: 'inflight' } as const, [])
const shimmerAtom = atom({ plugin: 'tree-explained', key: 'shimmer' } as const, false)
const summariesAtom = atom({ plugin: 'tree-explained', key: 'summaries' } as const, [])
const langAtom = atom({ plugin: 'tree-explained', key: 'lang' } as const, null)
// Foreign ref: the optional `menu` mod owns it (apiVersion 1); undefined = no menu.
const menuPanel = { plugin: 'menu', key: 'panel' } as const
const menuEntryRef = { plugin: 'tree-explained', key: 'menuEntry' } as const

const PANE = 'tree-explained'
const MENU_PANE = 'mods-menu'
// The model asked for the summary: a small alias the engine resolves (`$.model.complete` documents `haiku`).
const SUMMARY_MODEL = 'haiku'

let cwd = ''
let seq = 0
let turnNo = 0
let epoch = 0 // bumped on every reset: a summary that finishes after /clear is dropped
let firstPrompt: string | null = null
let pending = newPending()
const inflight = new Map<string, string>()
let timer: Timer | undefined

const stopTimer = () => {
  timer?.cancel()
  timer = undefined
}

const writeEntry = async ($: EngineInterface) => {
  const entry: MenuEntry = { apiVersion: 1, title: 'tree-explained', summary: (await read($, isOnAtom)) ? 'on' : 'off', order: 5 }
  await $.state.set(menuEntryRef, entry).catch(() => undefined)
}

const baseName = () => cwd.replace(/\/+$/, '').split('/').pop() || 'session'

// A new conversation (session start or /clear): the tree, the summaries and the language rule begin again.
async function reset($: EngineInterface) {
  epoch++
  seq = 0
  turnNo = 0
  firstPrompt = null
  pending = newPending()
  inflight.clear()
  stopTimer()
  await update($, filesAtom, () => ({}))
  await update($, summariesAtom, () => [])
  await update($, inflightAtom, () => [])
  await update($, shimmerAtom, () => false)
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: baseName(), focus: true, closeOnEscape: true })

async function setOn($: EngineInterface, isOn: boolean) {
  await update($, isOnAtom, () => isOn)
  await $.store.set('isOn', isOn)
  await writeEntry($)
  if (isOn) await openPane($)
  else {
    pending = newPending()
    stopTimer()
    await $.ui.close({ id: PANE })
  }
}

async function setLang($: EngineInterface, lang: string | null) {
  await update($, langAtom, () => lang)
  if (lang === null) await $.store.delete('lang')
  else await $.store.set('lang', lang)
}

// One summary per finished turn that changed files; the model's reply, else a deterministic line per file.
async function summarize($: EngineInterface, changes: Change[], more: number, mine: number, turn: number) {
  let text = ''
  try {
    const { system, prompt } = buildRequest(changes, await read($, langAtom), firstPrompt, more)
    const r = await $.model.complete({ model: SUMMARY_MODEL, system, prompt, maxTokens: 500, timeoutMs: 30000 })
    if (r.isAnswered) text = cleanReply(r.text)
  } catch {}
  const isFallback = text === ''
  if (isFallback) text = fallbackSummary(changes, more)
  if (mine !== epoch) return
  // numbered when the turn ended; a slower earlier summary still lands in turn order
  await update($, summariesAtom, list => [...list, { turn, text, isFallback }].sort((a, b) => a.turn - b.turn).slice(-MAX_SUMMARIES))
}

// The file tools: the file shows (and shimmers) while the call runs; edits count their lines when it succeeds.
async function onFile($: EngineInterface, e: any, next: any) {
  const src = e
  const born = epoch // a call that outlives a reset must not touch the fresh tree
  const isEdit = e.tool !== 'Read'
  const id = String(e.tool_use_id ?? `call-${seq}`)
  let path = ''
  let before: Entry | undefined
  try {
    if (typeof src.file_path === 'string' && src.file_path !== '') {
      path = relPath(src.file_path, cwd)
      before = (await read($, filesAtom))[path]
      await update($, filesAtom, f => touch(f, { path, kind: isEdit ? 'edit' : 'read', add: 0, del: 0 }, ++seq))
      inflight.set(id, path)
      await update($, inflightAtom, () => [...inflight.values()])
      if (timer === undefined && (await read($, isOnAtom))) timer = $.clock.every(500, () => void update($, shimmerAtom, s => !s).catch(() => undefined))
    }
  } catch {
    path = ''
  }
  let res: any
  let failed = true // a call that throws, is denied or errors leaves no trace in the tree
  try {
    res = await next(e)
    failed = res.deny !== undefined || res.isError === true
  } finally {
    if (path !== '') {
      inflight.delete(id)
      try {
        await update($, inflightAtom, () => [...inflight.values()])
        if (inflight.size === 0) {
          stopTimer()
          await update($, shimmerAtom, () => false)
        }
      } catch {}
      if (failed && born === epoch) {
        const prev = before
        await update($, filesAtom, f => {
          const { [path]: _gone, ...rest } = f
          return prev === undefined ? rest : { ...rest, [path]: prev }
        }).catch(() => undefined)
      }
    }
  }
  try {
    if (path !== '' && born === epoch && isEdit && !failed) {
      const c =
        e.tool === 'Write'
          ? change(path, true, '', String(src.content ?? ''))
          : change(path, false, String(src.old_string ?? ''), String(src.new_string ?? ''))
      await update($, filesAtom, f => touch(f, { path, kind: 'edit', add: c.add, del: c.del }, ++seq))
      if (await read($, isOnAtom)) record(pending, c)
    }
  } catch {}
  return res
}

async function tree($: EngineInterface, e: any) {
  return treePage($.ui.resolve(e), {
    title: baseName(),
    rows: buildRows(await read($, filesAtom)),
    inflight: await read($, inflightAtom),
    shimmer: await read($, shimmerAtom),
    summaries: await read($, summariesAtom),
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd ?? (await $.session.cwd().catch(() => ''))
    try {
      await reset($)
      const isOn = (await $.store.get('isOn')) === true
      const lang = await $.store.get('lang')
      await update($, isOnAtom, () => isOn)
      await update($, langAtom, () => (typeof lang === 'string' && lang !== '' ? cleanLang(lang) : null))
      await writeEntry($)
      await $.command
        .register({ name: 'tree-explained', description: 'Show the files Claude touched and a summary of each turn', argumentHint: '[lang <language>|lang auto]' })
        .catch(() => undefined)
      // ponytail: opened on its own, the engine may leave it undrawn below 144 columns (110 once the person has opened it before).
      if (isOn) await openPane($).catch(() => undefined)
    } catch {}
    return next(e)
  })

  // /clear (no session.start follows) or a resume: either way a conversation ends.
  on('session.end', async ($, e, next) => {
    await reset($).catch(() => undefined)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // The language rule reads the person's own first non-slash prompt only.
    if (firstPrompt === null && !e.text.startsWith('/') && (e.origin === undefined || e.origin.kind === 'composer')) {
      const text = cleanText(e.text, true).trim().slice(0, 300)
      if (text !== '') firstPrompt = text
    }
    return next(e)
  })

  on('command.run', { command: 'tree-explained' }, async ($, e) => {
    try {
      const args = e.args.trim()
      const m = /^lang(?:\s+([\s\S]*))?$/i.exec(args)
      if (m) {
        const raw = (m[1] ?? '').trim()
        const current = await read($, langAtom)
        if (raw === '') return { text: `Summary language: ${current ?? 'follows your first prompt'}. Use /tree-explained lang <language> or lang auto.` }
        if (raw.toLowerCase() === 'auto') {
          await setLang($, null)
          return { text: 'Summary language follows your first prompt.' }
        }
        const lang = cleanLang(raw)
        if (lang === '') return { text: 'Give a language, for example /tree-explained lang Portuguese.' }
        await setLang($, lang)
        return { text: `Summary language: ${lang}.` }
      }
      if (args !== '') return { text: 'Usage: /tree-explained, /tree-explained lang <language>, /tree-explained lang auto.' }
      // ponytail: a pane the engine left undrawn still counts as on; the next /tree-explained turns it off, the one after opens it.
      const next = !(await read($, isOnAtom))
      await setOn($, next)
      return { text: next ? 'tree-explained is on.' : 'tree-explained is off.' }
    } catch (error) {
      return { text: `tree-explained could not change: ${String(error)}` }
    }
  })

  // The person closing the pane turns it off for good (and for the next session).
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person' && (await read($, isOnAtom).catch(() => false))) {
      await update($, isOnAtom, () => false).catch(() => undefined)
      pending = newPending()
      await $.store.set('isOn', false).catch(() => undefined)
      await writeEntry($)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => tree($, e))

  // Inside the menu's pane (apiVersion 1): drawn only when the menu is on this panel.
  on('ui.render', { component: 'Pane', requestId: MENU_PANE }, async ($, e, next) => {
    const { value } = await $.state.get(menuPanel)
    if (value !== 'tree-explained') return next(e)
    return settingsPage($.ui.resolve(e), {
      isOn: await read($, isOnAtom),
      lang: await read($, langAtom),
      onToggle: () => void read($, isOnAtom).then(v => setOn($, !v)).catch(error => $.ui.toast(`Could not change: ${String(error)}`)),
      // the menu mod handles this press itself (ui.press on this plugin's key); the closure keeps the Button pressable
      onBack: () => undefined,
    })
  })

  // one call each: the matcher is typed per tool, a union of names does not fit it
  on('tool.call', { tool: 'Edit' }, onFile)
  on('tool.call', { tool: 'Write' }, onFile)
  on('tool.call', { tool: 'Read' }, onFile)

  // The summary is asked after the turn, never inside it: the next prompt does not wait.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && pending.files.size > 0) {
      const changes = [...pending.files.values()]
      const more = pending.lost.size
      pending = newPending()
      // the mod may have been turned off since the edits: nothing is sent then
      if (await read($, isOnAtom).catch(() => false)) {
        const mine = epoch
        const turn = ++turnNo
        $.clock.after(0, () => void summarize($, changes, more, mine, turn).catch(() => undefined))
      }
    }
    return next(e)
  })
}
