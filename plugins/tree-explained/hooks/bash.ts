import { cleanText } from './tree'

// Pure parts of the Bash change tracking: parsing what read-only git prints. Nothing here runs a command.
export const MAX_DIRTY = 500
export const SLACK_MS = 1000
export const GIT_TIMEOUT = 8000

// Every git call the mod makes: no repo-configured program may run (fsmonitor, external diff, text conversion, pager, hooks),
// pathspecs are literal, and a path list always comes after `--` so a path can never read as an option.
// Attributes are switched off (the empty tree as the attribute source, no global attributes file, no system one) so that no
// attribute-driven filter driver runs; `$GIT_DIR/info/attributes` is NOT covered by that, so the filter drivers the
// repository's config defines are replaced by `cat` (see `filterArgs`). Needs git 2.40 or newer (`--attr-source`).
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
export const GIT_FLAGS = ['--no-optional-locks', '--literal-pathspecs', `--attr-source=${EMPTY_TREE}`, '-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null', '-c', 'diff.submodule=short', '-c', 'submodule.recurse=false', '-c', 'status.submoduleSummary=false', '-c', 'protocol.allow=never']
// GIT_NO_LAZY_FETCH (git 2.45+): a partial clone never fetches a missing object while we diff; `protocol.allow=never` closes every transport.
export const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', GIT_ATTR_NOSYSTEM: '1', GIT_NO_LAZY_FETCH: '1' }
export const gitArgv = (dir: string, sub: string, opts: readonly string[] = [], paths?: readonly string[], extra: readonly string[] = []): string[] => [
  'git',
  ...GIT_FLAGS,
  ...extra,
  '-C',
  dir,
  sub,
  ...(sub === 'diff' ? ['--no-ext-diff', '--no-textconv'] : []),
  ...(sub === 'diff' || sub === 'status' ? ['--ignore-submodules=all'] : []),
  ...opts,
  ...(paths === undefined ? [] : ['--', ...paths]),
]

// U = untracked, D = deleted, M = anything else that differs from HEAD.
export type Code = 'M' | 'U' | 'D'
export type Dirty = { path: string; code: Code }

// A path from git that is safe to stat and to draw: control characters (a NUL or newline artefact, an escape sequence) drop the entry.
const clean = (p: string) => (p !== '' && cleanText(p) === p ? p : undefined)

// `status --porcelain=v1 -z --no-renames`: "XY path" entries separated by NUL.
export function parseStatus(stdout: string): Dirty[] {
  const out: Dirty[] = []
  for (const raw of stdout.split('\0')) {
    if (raw.length < 4 || raw[2] !== ' ') continue
    const xy = raw.slice(0, 2)
    const path = clean(raw.slice(3))
    if (path === undefined || xy === '!!') continue
    out.push({ path, code: xy === '??' ? 'U' : xy.includes('D') ? 'D' : 'M' })
  }
  return out
}

export type Num = { add: number; del: number; binary: boolean }

// `diff --numstat -z --no-renames`: "add<TAB>del<TAB>path" entries separated by NUL; a binary file prints "-<TAB>-".
export function parseNumstat(stdout: string): Map<string, Num> {
  const out = new Map<string, Num>()
  for (const raw of stdout.split('\0')) {
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(raw)
    const path = m ? clean(m[3]!) : undefined
    if (!m || path === undefined) continue
    out.set(path, m[1] === '-' ? { add: 0, del: 0, binary: true } : { add: Number(m[1]), del: Number(m[2]), binary: false })
  }
  return out
}

// The files to report: deleted ones once, the others when modified since the last sweep (minus a slack) and not already
// seen at that mtime. A missing mtime on a non-deleted entry means it vanished: not flagged. Capped at MAX_DIRTY, newest first.
export function pickChanged(entries: Dirty[], mtimes: ReadonlyMap<string, number>, seen: ReadonlyMap<string, number>, deletedSeen: ReadonlySet<string>, sinceMs: number, slackMs = SLACK_MS): Dirty[] {
  const hit = entries.filter(d => {
    if (d.code === 'D') return !deletedSeen.has(d.path)
    const m = mtimes.get(d.path)
    return m !== undefined && m > sinceMs - slackMs && m !== seen.get(d.path)
  })
  return hit.sort((a, b) => (mtimes.get(b.path) ?? 0) - (mtimes.get(a.path) ?? 0)).slice(0, MAX_DIRTY)
}

// `diff HEAD --unified=1` for several files: one patch per path, from its first hunk; headers dropped, binary files skipped.
export function splitPatches(stdout: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const chunk of stdout.split(/^diff --git /m).slice(1)) {
    const at = chunk.search(/^@@/m)
    if (at < 0) continue
    const head = chunk.slice(0, at)
    const name = /^\+\+\+ b\/(.+?)\t?$/m.exec(head)?.[1] ?? /^--- a\/(.+?)\t?$/m.exec(head)?.[1]
    const path = name === undefined ? undefined : clean(name)
    if (path !== undefined) out.set(path, chunk.slice(at).replace(/\n+$/, ''))
  }
  return out
}

// `git version 2.53.0`, `git version 2.43.0.windows.1`; anything else is unparseable.
export function parseGitVersion(out: string): { major: number; minor: number } | undefined {
  const m = /^git version (\d+)\.(\d+)/.exec(out.trim())
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : undefined
}
export const atLeast = (out: string, major: number, minor: number) => {
  const v = parseGitVersion(out)
  return v !== undefined && (v.major > major || (v.major === major && v.minor >= minor))
}
// The tracking needs git 2.45: GIT_NO_LAZY_FETCH is honoured from there on, and a partial clone cannot fetch while we diff.
export const isNewEnough = (out: string) => atLeast(out, 2, 45)

export const MAX_STATUS = 2000 // dirty entries looked at per sweep
export const MAX_TRACKED = 2000 // entries kept in each of the mod's path maps
// Drops the oldest insertions past `max`.
export function capMap<K, V>(m: Map<K, V>, max = MAX_TRACKED) {
  while (m.size > max) m.delete(m.keys().next().value as K)
}

// `config --name-only --null --get-regexp`: the filter drivers the repository defines. Each is replaced by `cat` (no `process`
// either) for our calls, so a repository's own clean program never runs. null = a name `-c` cannot spell, or too many: do not run git.
export const MAX_FILTERS = 200 // more drivers than this: git is not run (every driver costs a `-c` pair, and time)
export const FILTER_KEYS = '^filter\\..*\\.(clean|process)$'
export function filterArgs(stdout: string): string[] | null {
  const names = new Set<string>()
  for (const key of stdout.split('\0')) {
    const m = /^filter\.([\s\S]+)\.(?:clean|process)$/.exec(key)
    if (!m) continue
    if (!/^[A-Za-z0-9._+-]+$/.test(m[1]!)) return null // only plain names: anything else (a decoded byte, a space, `=`, a control) fails closed
    names.add(m[1]!)
  }
  if (names.size > MAX_FILTERS) return null
  return [...names].flatMap(n => ['-c', `filter.${n}.clean=cat`, '-c', `filter.${n}.process=`])
}

export const chunks = <T>(list: readonly T[], n = 100): T[][] => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n))
