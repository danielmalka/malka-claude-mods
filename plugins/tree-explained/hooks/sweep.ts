import type { EngineInterface } from 'claude-code'

import { capMap, chunks, FILTER_KEYS, filterArgs, GIT_ENV, GIT_TIMEOUT, gitArgv, isNewEnough, MAX_DIRTY, MAX_STATUS, parseNumstat, parseStatus, pickChanged, splitPatches } from './bash'
import type { Code, Dirty, Num } from './bash'
import { change, DIFF_CAP, isSecretName } from './summary'
import type { Change } from './summary'
import { countLines, normalize } from './tree'

// The impure side of the Bash change tracking: read-only local git, file stats. Never throws into a hook.
export type Flag = { abs: string; code: Code; add: number; del: number; change: Change }

const MAX_READ = 4 * 1024 * 1024
const STAT_BATCH = 50
const MAX_FAILS = 3

const seen = new Map<string, number>() // absolute path -> the mtime already reported (or written by Edit/Write)
const deletedSeen = new Set<string>()
const NEG_TTL = 30_000 // a folder that is not a repository is asked again after this long (a `git init` later)
const repos = new Map<string, { top: string | null; until: number }>() // session folder -> repo top
const origin = new Map<string, { top: string; rel: string }>() // absolute path -> where git knows it
let lastSweepMs = 0
let bgSeen = false
let failStreak = 0
let paused = false
let gitOk: boolean | null = null // is the installed git new enough, asked once per session

export function resetSweep() {
  seen.clear()
  deletedSeen.clear()
  repos.clear()
  origin.clear()
  lastSweepMs = 0
  bgSeen = false
  failStreak = 0
  paused = false
  gitOk = null
}

export const markBackground = () => void (bgSeen = true)
export function takeBackground() {
  const was = bgSeen
  bgSeen = false
  return was
}

const absOf = (cwd: string, file: string) => normalize(file.startsWith('/') ? file : `${cwd}/${file}`)

// After a successful Edit/Write: its own write must not read as a Bash change on the next sweep.
export async function markSeen($: EngineInterface, cwd: string, file: string) {
  try {
    const abs = absOf(cwd, file)
    const s = await $.fs.stat(abs, { resolve: true })
    seen.set(s.realPath ?? abs, s.mtimeMs) // git reports realpaths
  } catch {}
}

const PAUSE_TEXT = 'tree-explained: Bash change tracking paused (git did not answer).'
const OLD_GIT_TEXT = 'tree-explained: Bash change tracking is paused because git 2.45 or newer is required.'

// Three failures in a row pause the tracking for the session, with one toast. A dead session counts nothing.
function bump($: EngineInterface, alive: () => boolean) {
  if (alive() && ++failStreak === MAX_FAILS) {
    paused = true
    $.ui.toast(PAUSE_TEXT)
  }
}

// null when the command could not run or timed out (counted); the caller judges the exit code.
async function run($: EngineInterface, argv: string[], alive: () => boolean) {
  try {
    return await $.process.run(argv, { env: GIT_ENV, timeoutMs: GIT_TIMEOUT })
  } catch {
    bump($, alive)
    return null
  }
}

// Once per session: is the installed git able to turn attributes off? If not, no other git command ever runs.
async function gitUsable($: EngineInterface, alive: () => boolean) {
  if (gitOk !== null) return gitOk
  const r = await run($, ['git', '--version'], alive)
  if (r === null || !alive()) return false
  gitOk = r.exitCode === 0 && isNewEnough(r.stdout)
  if (!gitOk) {
    paused = true
    $.ui.toast(OLD_GIT_TEXT)
  }
  return gitOk
}

// The `-c` arguments that replace the repository's filter drivers; null = do not run git in this repository.
async function filters($: EngineInterface, top: string, alive: () => boolean) {
  const r = await run($, gitArgv(top, 'config', ['--name-only', '--null', '--get-regexp', FILTER_KEYS]), alive)
  if (r === null || !alive()) return null // a rejected spawn was counted by `run`
  if (r.isStdoutTruncated === true || (r.exitCode !== 0 && r.exitCode !== 1)) {
    bump($, alive)
    return null
  }
  const args = r.exitCode === 1 ? [] : filterArgs(r.stdout) // 1 = no filter defined
  if (args === null) bump($, alive) // a name `-c` cannot spell, or too many: git is not run, and the pause counts it
  return args
}

async function repoTop($: EngineInterface, cwd: string, now: number, alive: () => boolean) {
  const hit = repos.get(cwd)
  if (hit !== undefined && (hit.top !== null || hit.until > now)) return hit.top
  const r = await run($, gitArgv(cwd, 'rev-parse', ['--show-toplevel']), alive)
  if (r === null || !alive()) return undefined // undefined: asking failed; null: not a repository
  const top = r.exitCode === 0 ? r.stdout.trim().replace(/\/+$/, '') : ''
  repos.set(cwd, { top: top === '' ? null : top, until: now + NEG_TTL })
  return top === '' ? null : top
}

// git's top is a realpath: classify the files against the realpath of the session folder too.
export async function realCwd($: EngineInterface, cwd: string) {
  try {
    return (await $.fs.stat(cwd, { resolve: true })).realPath ?? cwd
  } catch {
    return cwd
  }
}

// The text of an untracked file, or undefined when it is too big or binary (name only then).
// Asked again right before the read: it must still be a plain file, not a link, and really live at this path under the repo.
async function content($: EngineInterface, abs: string) {
  try {
    const s = await $.fs.stat(abs, { resolve: true })
    if (s.kind !== 'file' || s.isLink || s.size > MAX_READ || s.realPath !== abs) return undefined
    const text = await $.fs.read(abs)
    return typeof text === 'string' && text.length <= MAX_READ && !text.slice(0, 8192).includes('\0') ? text : undefined
  } catch {
    return undefined
  }
}

// One sweep: the git-dirty files whose mtime moved since the last sweep. `baseline` only records what is already dirty.
// `alive` says whether the session is still the one that started the sweep: a stale sweep touches no state.
export async function sweep($: EngineInterface, cwd: string, alive: () => boolean, baseline = false): Promise<Flag[]> {
  if (paused) return []
  const start = await $.clock.now()
  const since = lastSweepMs
  const first = baseline || since === 0 // nothing to compare with yet: record, flag nothing
  if (!alive() || !(await gitUsable($, alive)) || !alive()) return []
  const top = await repoTop($, cwd, start, alive)
  if (top === undefined || !alive()) return []
  if (top === null) {
    lastSweepMs = Math.max(lastSweepMs, start) // a clear answer: not a repository
    return []
  }
  const extra = await filters($, top, alive)
  if (extra === null || !alive()) return []
  const st = await run($, gitArgv(top, 'status', ['--porcelain=v1', '-z', '-uall', '--no-renames'], undefined, extra), alive)
  if (st === null || !alive()) return []
  if (st.exitCode !== 0 || st.isStdoutTruncated === true) {
    bump($, alive) // never flag from partial output
    return []
  }
  lastSweepMs = Math.max(lastSweepMs, start) // only a sweep that saw the status moves the mark: an aborted one is retried over the same window
  const dirty: Dirty[] = parseStatus(st.stdout).slice(0, MAX_STATUS).map(d => ({ ...d, path: `${top}/${d.path}` }))
  const mtimes = new Map<string, number>()
  const regular = new Set<string>() // a plain file, not a link: the only kind whose content is ever read
  for (const batch of chunks(dirty, STAT_BATCH)) {
    await Promise.all(
      batch.map(async d => {
        if (d.code === 'D') return
        try {
          const s = await $.fs.stat(d.path)
          mtimes.set(d.path, s.mtimeMs)
          if (s.kind === 'file' && !s.isLink) regular.add(d.path)
        } catch {} // vanished, or unreadable: skipped below, never read as a delete
      }),
    )
  }
  if (!alive()) return []
  const live = dirty.filter(d => d.code === 'D' || mtimes.has(d.path))
  const gone = new Set(live.filter(d => d.code === 'D').map(d => d.path))
  for (const p of deletedSeen) if (!gone.has(p)) deletedSeen.delete(p) // forget files that came back
  if (first) {
    failStreak = 0
    for (const d of live) d.code === 'D' ? deletedSeen.add(d.path) : seen.set(d.path, mtimes.get(d.path)!)
    return []
  }
  const hit = pickChanged(live, mtimes, seen, deletedSeen, since)
  const hadDeleted = new Set(hit.filter(d => deletedSeen.has(d.path)).map(d => d.path))
  const hadSeen = new Map(hit.map(d => [d.path, seen.get(d.path)]))
  for (const d of hit) d.code === 'D' ? deletedSeen.add(d.path) : seen.set(d.path, mtimes.get(d.path)!)
  capMap(seen)
  if (hit.length === 0) {
    failStreak = 0
    return []
  }
  const undo = () => {
    if (!alive()) return
    for (const d of hit) {
      if (d.code === 'D') hadDeleted.has(d.path) || deletedSeen.delete(d.path)
      else if (hadSeen.get(d.path) === undefined) seen.delete(d.path)
      else seen.set(d.path, hadSeen.get(d.path)!)
    }
  }
  const rel = (abs: string) => abs.slice(top.length + 1)
  for (const d of hit) origin.set(d.path, { top, rel: rel(d.path) })
  capMap(origin)
  // totals against HEAD for the tracked ones; a repository without commits makes everything untracked
  const nums = new Map<string, Num>()
  let hasHead = true
  const secretRel = (d: Dirty) => isSecretName(d.path) // judged on the absolute path, decided first: such a file is never read and never named to git
  const tracked = hit.filter(d => d.code !== 'U' && !secretRel(d))
  for (const part of chunks(tracked, 100)) {
    if (!alive()) return []
    const r = await run($, gitArgv(top, 'diff', ['HEAD', '--numstat', '-z', '--no-renames'], part.map(d => rel(d.path)), extra), alive)
    if (r === null || r.isStdoutTruncated === true) {
      if (r !== null) bump($, alive)
      undo() // never flag a batch without its counters: the next sweep retries these files
      return []
    }
    if (r.exitCode !== 0) {
      hasHead = false // 128, bad revision HEAD: a repository without commits
      continue
    }
    for (const [p, n] of parseNumstat(r.stdout)) nums.set(`${top}/${p}`, n)
  }
  if (!alive()) return []
  failStreak = 0 // the sweep went through: only now does a streak of failures end
  const flags: Flag[] = []
  for (const d of hit) {
    const secret = secretRel(d)
    if (d.code === 'U' || (!hasHead && d.code === 'M')) {
      const text = !secret && regular.has(d.path) ? await content($, d.path) : undefined
      const add = text === undefined ? 0 : countLines(text)
      flags.push({ abs: d.path, code: 'U', add, del: 0, change: { ...change(d.path, true, '', text ?? ''), add, kind: 'bash', ...(secret ? { secret: true as const } : {}) } })
      continue
    }
    if (d.code === 'D' && !hasHead && !secret) continue
    const n = secret ? { add: 0, del: 0, binary: false } : (nums.get(d.path) ?? { add: 0, del: 0, binary: false })
    const kind = d.code === 'D' ? ('deleted' as const) : ('bash' as const)
    flags.push({ abs: d.path, code: d.code, add: n.add, del: n.del, change: { path: d.path, isWrite: false, add: n.add, del: n.del, parts: [], kind, ...(secret ? { secret: true as const } : {}) } })
  }
  return alive() ? flags : []
}

// The patch of each tracked, non-secret Bash-changed file, cut to the per-text cap. `path` of a Change is the tree path:
// `abs` is the absolute one it was flagged under.
export async function fetchPatches($: EngineInterface, wanted: { path: string; abs: string }[], alive: () => boolean) {
  const byTop = new Map<string, string[]>()
  for (const w of wanted) {
    const o = origin.get(w.abs)
    if (o !== undefined && !isSecretName(w.abs)) byTop.set(o.top, [...(byTop.get(o.top) ?? []), o.rel])
  }
  const out = new Map<string, string>() // absolute path -> patch
  for (const [top, rels] of byTop) {
    if (!alive()) return out
    const extra = await filters($, top, alive)
    for (const part of chunks(rels.slice(0, MAX_DIRTY), 100)) {
      if (extra === null || !alive()) return out
      const r = await run($, gitArgv(top, 'diff', ['HEAD', '--no-renames', '--unified=1'], part, extra), alive)
      if (r !== null && r.isStdoutTruncated === true) bump($, alive)
      if (r === null || r.exitCode !== 0 || r.isStdoutTruncated === true) continue
      for (const [p, text] of splitPatches(r.stdout)) out.set(`${top}/${p}`, text.slice(0, DIFF_CAP))
    }
  }
  return out
}
