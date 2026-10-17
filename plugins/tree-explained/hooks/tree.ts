import type { Entry } from '../types'

export const MAX_FILES = 300

// Escape sequences first (so their payload goes too), then every remaining control character.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b./g
// plus the characters that reorder or hide text: bidi marks and overrides, zero-width characters, line and paragraph separators
const INVISIBLE = '\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff'
const CTRL = new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f${INVISIBLE}]`, 'g')
const CTRL_KEEP_LINES = new RegExp(`[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f${INVISIBLE}]`, 'g')

// Safe to draw or to send: a file name or a model reply may carry escape sequences.
export const cleanText = (s: string, keepLines = false) => s.replace(ANSI, '').replace(keepLines ? CTRL_KEEP_LINES : CTRL, '')

// Resolves `.` and `..` and drops empty segments and a trailing slash; a relative path stays relative.
export function normalize(p: string) {
  const out: string[] = []
  for (const s of p.split('/')) {
    if (s === '' || s === '.') continue
    if (s === '..') out.pop()
    else out.push(s)
  }
  return (p.startsWith('/') ? '/' : '') + out.join('/')
}

// Is `path` the cwd or below it? Whole segments only: /proj-other/x is not inside /proj. An unknown cwd counts everything as inside.
export function inside(cwd: string, path: string) {
  const base = normalize(cwd)
  if (base === '') return true
  const p = path.startsWith('/') ? normalize(path) : normalize(`${base}/${path}`)
  return p === base || p.startsWith(base === '/' ? '/' : `${base}/`)
}

// Relative to the cwd when below it, else the normalized absolute path.
export function relPath(file: string, cwd: string) {
  const f = cleanText(file)
  const n = f.startsWith('/') ? normalize(f) : f
  const base = normalize(cwd)
  return base !== '' && n.startsWith(`${base === '/' ? '' : base}/`) ? n.slice(base === '/' ? 1 : base.length + 1) : n
}

// Where a touched file goes in the tree: its key in the files map and whether it is outside the project.
export function locate(file: string, cwd: string) {
  const f = cleanText(file)
  const base = normalize(cwd)
  const abs = f.startsWith('/') || base === '' ? normalize(f) : normalize(`${base}/${f}`)
  const outside = !inside(base, abs)
  return { path: outside ? abs : relPath(abs, base), outside }
}

// Lines of a text as a diff counts them: a trailing newline does not add one.
export const countLines = (s: string) => (s === '' ? 0 : s.replace(/\n$/, '').split('\n').length)

// `abs`: add/del are totals that replace the file's counters (the Bash sweep); else they sum.
export type Touch = { path: string; kind: 'read' | 'edit'; add: number; del: number; outside?: boolean; abs?: boolean }

// Adds a touch to the files record (new object), dropping the oldest-touched past MAX_FILES.
export function touch(files: Record<string, Entry>, t: Touch, seq: number): Record<string, Entry> {
  const prev = files[t.path]
  const next = {
    ...files,
    [t.path]: {
      path: t.path,
      kind: t.kind === 'edit' || prev?.kind === 'edit' ? ('edit' as const) : ('read' as const),
      add: t.abs ? t.add : (prev?.add ?? 0) + t.add,
      del: t.abs ? t.del : (prev?.del ?? 0) + t.del,
      seq,
      ...(t.outside || prev?.outside ? { outside: true as const } : {}),
    },
  }
  const keys = Object.keys(next)
  if (keys.length > MAX_FILES) {
    keys.sort((a, b) => next[a]!.seq - next[b]!.seq)
    for (const k of keys.slice(0, keys.length - MAX_FILES)) delete next[k]
  }
  return next
}

export const OUTSIDE = '(outside project)'
export const rowKey = (path: string) => `row-${path}`

// A file row has `entry`; a folder row has the counts and sums of the files below it (shown while it is closed).
export type Row = {
  key: string
  prefix: string
  name: string
  isDir: boolean
  entry?: Entry
  isOpen: boolean
  hasKids: boolean
  edits: number
  reads: number
  add: number
  del: number
  suffix: string
}
type Node = { name: string; path: string; kids: Map<string, Node>; entry?: Entry; synthetic?: boolean }

// The folder keys above a file: every ancestor, or the one outside row.
export function ancestors(path: string, outside = false): string[] {
  if (outside) return [OUTSIDE]
  const segs = path.split('/').filter(Boolean).slice(0, -1)
  return segs.map((_, i) => segs.slice(0, i + 1).join('/'))
}

export const allFolders = (files: Record<string, Entry>) => [...new Set(Object.values(files).flatMap(e => ancestors(e.path, e.outside)))]
export const MAX_OPEN = 2000
export const openAll = (open: readonly string[], keys: readonly string[]) => [...new Set([...open, ...keys])].slice(-MAX_OPEN)

const leaves = (n: Node): Entry[] => [...(n.entry ? [n.entry] : []), ...[...n.kids.values()].flatMap(leaves)]
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

// The visible tree as rows: directories first, then files, each group sorted by name, the outside row last; Unicode guides.
// A folder shows its children only while its key is in `open`; `hideReads` drops files that were only read (and the folders they leave empty).
export function buildRows(files: Record<string, Entry>, open: readonly string[] = [], hideReads = false): Row[] {
  const isOpen = new Set(open)
  const root: Node = { name: '', path: '', kids: new Map() }
  const outside: Node = { name: OUTSIDE, path: OUTSIDE, kids: new Map(), synthetic: true }
  for (const entry of Object.values(files)) {
    if (hideReads && entry.kind === 'read') continue
    if (entry.outside) {
      const label = entry.path.split('/').filter(Boolean).slice(-2).join('/')
      outside.kids.set(entry.path, { name: label, path: entry.path, kids: new Map(), entry })
      continue
    }
    let node = root
    entry.path.split('/').filter(Boolean).forEach((seg, i, segs) => {
      let kid = node.kids.get(seg)
      if (!kid) node.kids.set(seg, (kid = { name: seg, path: node.path === '' ? seg : `${node.path}/${seg}`, kids: new Map() }))
      if (i === segs.length - 1) kid.entry = entry
      node = kid
    })
  }
  if (outside.kids.size > 0) root.kids.set('\0outside', outside)
  const rows: Row[] = []
  const walk = (node: Node, guide: string) => {
    const kids = [...node.kids.values()].sort((a, b) => {
      const da = a.synthetic ? 2 : a.kids.size > 0 ? 0 : 1
      const db = b.synthetic ? 2 : b.kids.size > 0 ? 0 : 1
      return da - db || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    })
    kids.forEach((kid, i) => {
      const last = i === kids.length - 1
      const isDir = kid.kids.size > 0
      const open = isDir && isOpen.has(kid.path)
      const es = isDir ? leaves(kid) : []
      const edits = es.filter(e => e.kind === 'edit').length
      const reads = es.length - edits
      const parts = [...(kid.synthetic ? [plural(es.length, 'file')] : []), ...(edits ? [plural(edits, 'edit')] : []), ...(reads ? [plural(reads, 'read')] : [])]
      rows.push({
        key: isDir ? kid.path : (kid.entry?.path ?? kid.path),
        prefix: guide + (last ? '└─ ' : '├─ '),
        name: isDir && !kid.synthetic ? `${kid.name}/` : kid.name,
        isDir,
        entry: isDir ? undefined : kid.entry,
        isOpen: open,
        hasKids: isDir,
        edits,
        reads,
        add: es.reduce((n, e) => n + e.add, 0),
        del: es.reduce((n, e) => n + e.del, 0),
        suffix: !open && parts.length ? `(${parts.join(', ')})` : '',
      })
      if (open) walk(kid, guide + (last ? '   ' : '│  '))
    })
  }
  walk(root, '')
  return rows
}
