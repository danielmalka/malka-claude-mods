import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Effort, Model } from '../types'
import { autoLine, band, bandLines } from './band'
import { loadConfig } from './config'
import { decide } from './decide'
import { fromEngine } from './io'
import { EFFORTS } from './questions'

const WINDOW_MS = 10_000 // R15a: from submission, the decision call included

// Our routed effort, read by `mode` so it can tell it from the engine's own level (R19c).
const routedEffort = atom({ plugin: 'decision-router', key: 'effort' } as const, null)

const isEffort = (v: unknown): v is Effort => (EFFORTS as readonly unknown[]).includes(v)

// Foreign state of a plugin that may be absent: a failing read is "no value". References must be literal at the call site.
const manualSet = async ($: EngineInterface) => {
  try {
    return (await $.state.get({ plugin: 'mode', key: 'manual' })).value === true
  } catch {
    return false
  }
}
const modeHoldsEffort = async ($: EngineInterface) => {
  try {
    return ((await $.state.get({ plugin: 'mode', key: 'effort' })).value ?? null) !== null
  } catch {
    return false
  }
}

// What an accepted Switch put in force; null until then.
let plan: { model?: Model; effort?: Effort; modelPending: boolean } | null = null
let done = false // the first prompt was handled (R4/R24)
type Band = { lines: string[]; canSwitch: boolean; answer: ((v: 'switch' | 'keep') => void) | null }
let openBand: Band | null = null
let settleBand: ((v: 'switch' | 'keep') => void) | null = null // ends the pending hold, if any
let epoch = 0 // bumped by each session.start: a hold of an older session must change nothing
let seenEffort: Effort | undefined
// Subagents (R17, R19b): bands and holds are per spawn; efforts are keyed by agentId.
type SubBand = Band & { id: string }
let subBands: SubBand[] = []
const subSettlers = new Set<(v: 'switch' | 'keep') => void>()
const subEffort = new Map<string, Effort>() // agentId -> imposed effort
// Efforts whose agentId is not known yet, each with a start time (valid for AWAIT_MS only).
type Awaiting = { effort: Effort; description: string; type: string | undefined; parent: string | undefined; at: number }
let awaitingId: Awaiting[] = []
const knownIds = new Set<string>() // every agentId a routed spawn returned, with or without an effort
let spawnSeq = 0
const AWAIT_MS = 10_000
let idleShown = false // R1/R2: once per session
let invalidShown = false
let seenModel: string | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    settleBand?.('keep') // a band open from the previous session is released first
    for (const settle of [...subSettlers]) settle('keep')
    subSettlers.clear()
    subBands = []
    subEffort.clear()
    awaitingId = []
    knownIds.clear()
    spawnSeq = 0
    idleShown = false
    invalidShown = false
    epoch++
    plan = null
    done = false
    openBand = null
    settleBand = null
    seenEffort = undefined
    seenModel = undefined
    await update($, routedEffort, () => null).catch(() => undefined)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // Only the user's own first non-slash prompt of a fresh session is routed (R4).
    if (done || e.text.startsWith('/') || (e.origin !== undefined && e.origin.kind !== 'composer')) return next(e)
    done = true // before any await: a second submit right behind this one is not routed
    const mine = epoch
    try {
      if ((await $.session.turns()) > 0) return next(e)
      const startedAt = await $.clock.now()
      const io = fromEngine($)
      const cfg = await loadConfig(io)
      if (cfg.key === '') {
        if (!idleShown) $.ui.toast('Decision router is idle: DECISION_MOD_KEY is not set')
        idleShown = true
        return next(e)
      }
      if (cfg.invalid.length > 0 && !invalidShown) $.ui.toast(`Decision router: invalid ${cfg.invalid.join(', ')}, using the default`)
      invalidShown = true
      if (await manualSet($)) return next(e) // R18
      const effortHeld = await modeHoldsEffort($) // R19a
      const r = await decide(io, cfg, e.text)
      if (mine !== epoch) return next(e)
      if (!r.ok) {
        $.ui.toast(`Decision router: ${r.reason}; nothing changed`) // R20
        return next(e)
      }
      const offer = {
        model: r.modelConfidence >= cfg.minConfidence,
        effort: !effortHeld && r.effortConfidence >= cfg.minConfidence,
        effortHeld,
      }
      const remaining = WINDOW_MS - ((await $.clock.now()) - startedAt)
      if (remaining <= 0 || mine !== epoch) return next(e)
      const lines = bandLines(r, offer, cfg.minConfidence)
      const redraw = () => void Promise.resolve($.ui.invalidate('ui.render')).catch(() => undefined)
      if (!offer.model && !offer.effort) {
        // nothing to ask: the prompt goes at once; an informational band leaves by the mod's own timer
        const info: Band = { lines, canSwitch: false, answer: null }
        // arm the timer first: if it throws, no band is left standing
        $.clock.after(remaining, () => {
          if (openBand === info) {
            openBand = null
            redraw()
          }
        })
        openBand = info
        redraw()
        return next(e)
      }
      const answer = await new Promise<'switch' | 'keep'>(resolve => {
        let settled = false
        let timer: { cancel(): void } | undefined
        const finish = (v: 'switch' | 'keep') => {
          if (settled) return // a click after the window changes nothing (R15a)
          settled = true
          timer?.cancel()
          if (openBand === own) openBand = null
          if (settleBand === finish) settleBand = null
          redraw()
          resolve(v)
        }
        const own: Band = { lines, canSwitch: true, answer: finish }
        timer = $.clock.after(remaining, () => finish('keep')) // armed before the band is published
        openBand = own
        settleBand = finish
        redraw()
      })
      if (answer === 'switch' && mine === epoch) {
        const next_ = { model: offer.model ? r.model : undefined, effort: offer.effort ? r.effort : undefined, modelPending: offer.model }
        // publish first: if it fails nothing stays applied
        if (next_.effort) await update($, routedEffort, () => next_.effort ?? null)
        plan = next_
      }
    } catch (error) {
      if (mine === epoch) {
        plan = null
        await update($, routedEffort, () => null).catch(() => undefined)
        $.ui.toast(`Decision router: ${String(error)}; nothing changed`)
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const under = await next(e)
    if (openBand === null && subBands.length === 0) return under
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {under}
        {openBand && band($.ui.resolve(e), openBand.lines, openBand.canSwitch, openBand.answer)}
        {subBands.map(b => band($.ui.resolve(e), b.lines, b.canSwitch, b.answer, b.id, '◆ Decision router · subagent'))}
      </Box>
    )
  })

  // R5/R6/R17/R19b: a subagent spawned with no explicit model is routed per DECISION_MOD_SUBAGENTS.
  on('agent.spawn', async ($, e, next) => {
    if (e.fork || e.isTeammate) return next(e) // forks inherit their model; teammates run no loop here
    if (e.model !== undefined && e.model !== 'inherit') return next(e) // R5: explicit model, no call
    const mine = epoch
    let model: Model | undefined
    let effort: Effort | undefined
    let autoToast: string | undefined
    try {
      const startedAt = await $.clock.now()
      const io = fromEngine($)
      const cfg = await loadConfig(io)
      if (cfg.subagents === 'off') return next(e) // R6
      if (cfg.key === '') {
        if (!idleShown) $.ui.toast('Decision router is idle: DECISION_MOD_KEY is not set')
        idleShown = true
        return next(e)
      }
      if (cfg.invalid.length > 0 && !invalidShown) $.ui.toast(`Decision router: invalid ${cfg.invalid.join(', ')}, using the default`)
      invalidShown = true
      const r = await decide(io, cfg, e.prompt)
      if (mine !== epoch) return next(e)
      if (!r.ok) {
        $.ui.toast(`Decision router: subagent ${r.reason}; nothing changed`) // R20
        return next(e)
      }
      const offer = { model: r.modelConfidence >= cfg.minConfidence, effort: r.effortConfidence >= cfg.minConfidence, effortHeld: false }
      let apply = false
      if (cfg.subagents === 'auto') {
        autoToast = autoLine(r, offer, cfg.minConfidence) // shown once the spawn went through
        apply = true
      } else {
        const remaining = WINDOW_MS - ((await $.clock.now()) - startedAt)
        if (remaining > 0 && mine === epoch) {
          const redraw = () => void Promise.resolve($.ui.invalidate('ui.render')).catch(() => undefined)
          const lines = bandLines(r, offer, cfg.minConfidence)
          const id = `-sub${++spawnSeq}`
          if (!offer.model && !offer.effort) {
            // nothing to ask: the subagent starts at once; the informational band leaves by the mod's timer
            const info: SubBand = { lines, canSwitch: false, answer: null, id }
            $.clock.after(remaining, () => {
              subBands = subBands.filter(b => b !== info)
              redraw()
            })
            subBands.push(info)
            redraw()
          } else {
            const answer = await new Promise<'switch' | 'keep'>(resolve => {
              let settled = false
              let timer: { cancel(): void } | undefined
              const finish = (v: 'switch' | 'keep') => {
                if (settled) return
                settled = true
                timer?.cancel()
                subBands = subBands.filter(b => b !== own)
                subSettlers.delete(finish)
                redraw()
                resolve(v)
              }
              const own: SubBand = { lines, canSwitch: true, answer: finish, id }
              timer = $.clock.after(remaining, () => finish('keep'))
              subBands.push(own)
              subSettlers.add(finish)
              redraw()
            })
            apply = answer === 'switch' && mine === epoch
          }
        }
      }
      if (apply) {
        if (offer.model) model = r.model
        if (offer.effort) effort = r.effort
      }
    } catch (error) {
      if (mine === epoch) $.ui.toast(`Decision router: ${String(error)}; subagent unchanged`)
      model = undefined
      effort = undefined
    }
    const entry: Awaiting | undefined =
      effort === undefined ? undefined : { effort, description: e.description, type: e.subagentType, parent: e.agentId, at: await $.clock.now() }
    if (entry) awaitingId.push(entry)
    const drop = () => void (awaitingId = awaitingId.filter(w => w !== entry))
    let result
    try {
      result = await next(model !== undefined ? { ...e, model } : e)
    } catch (error) {
      drop()
      throw error
    }
    if (result.deny !== undefined) {
      drop()
      return result
    }
    if (autoToast !== undefined) $.ui.toast(autoToast)
    if (result.agentId !== undefined) {
      drop() // known now: the roster fallback is not needed for this entry
      knownIds.add(result.agentId)
      // ponytail: subEffort entries are removed at the agent's turn.complete; an agent that never completes keeps one small entry until session.start
      if (entry && mine === epoch && !subEffort.has(result.agentId)) subEffort.set(result.agentId, entry.effort)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      subEffort.delete(e.agentId)
      knownIds.delete(e.agentId)
    }
    return next(e)
  })

  // R19c: model on the first request, effort on every main-loop request while the override holds. No decision call here (R24).
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      // A subagent's step only gets its own effort; it never touches the main override or baseline (R19b).
      let level = subEffort.get(e.agentId)
      if (level === undefined && awaitingId.length > 0 && !knownIds.has(e.agentId)) {
        // The spawn hook has not got its agentId yet (race). Apply an effort only when it is unambiguous:
        // one live entry and one roster candidate (same description, type and parent) not already accounted for.
        const now = await $.clock.now()
        awaitingId = awaitingId.filter(w => now - w.at <= AWAIT_MS)
        const roster = await $.agent.list().catch(() => [])
        const info = roster.find(a => a.id === e.agentId)
        if (info !== undefined) {
          const same = (w: Awaiting) => w.description === info.description && (w.type === undefined || w.type === info.type) && w.parent === info.parentId
          const entries = awaitingId.filter(same)
          const candidates = roster.filter(a => a.description === info.description && !knownIds.has(a.id) && !subEffort.has(a.id) && (a.parentId === info.parentId))
          if (entries.length === 1 && candidates.length === 1) {
            level = entries[0].effort
            subEffort.set(e.agentId, level)
            knownIds.add(e.agentId)
            awaitingId = awaitingId.filter(w => w !== entries[0])
          }
        }
      }
      return yield* next(level !== undefined && e.effort !== undefined ? { ...e, effort: level } : e)
    }
    if (plan === null) return yield* next(e)
    let out = e
    // the user may have picked in /mode during the hold: that choice wins, drop the model switch
    if (plan.modelPending && e.index === 0 && (await manualSet($))) {
      plan.modelPending = false
      plan.model = undefined
    }
    if (plan.modelPending && e.index === 0) {
      const alias = plan.model as Model
      plan.modelPending = false
      out = { ...out, model: alias }
      // /model cannot run inside a hook: right after, as `mode` does
      $.clock.after(0, () => void $.command.run({ command: 'model', args: alias }).catch(error => $.ui.toast(`Decision router: could not switch the model: ${String(error)}`)))
    }
    if (plan.effort !== undefined) {
      // Our hook sits above `mode`, so e.effort is the engine's own level, whatever we wrote below on earlier steps.
      // Any change of it on the same model is the user's own /effort, newer than ours.
      if (e.model !== seenModel) seenEffort = undefined // another model (our /model): a new baseline
      seenModel = e.model
      let drop = (await manualSet($)) || (await modeHoldsEffort($))
      if (isEffort(e.effort)) {
        if (seenEffort !== undefined && e.effort !== seenEffort) drop = true
        seenEffort = e.effort
      }
      if (drop) {
        plan.effort = undefined
        await update($, routedEffort, () => null).catch(() => undefined)
      } else if (e.effort !== undefined) out = { ...out, effort: plan.effort }
    }
    return yield* next(out)
  })
}
