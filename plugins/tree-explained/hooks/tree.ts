import type { Entry } from '../types'

export const MAX_FILES = 300

// Escape sequences first (so their payload goes too), then every remaining control character.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b./g
const CTRL = /[\u0000-\u001f\u007f-\u009f]/g
const CTRL_KEEP_LINES = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g

// Safe to draw or to send: a file name or a model reply may carry escape sequences.
export const cleanText = (s: string, keepLines = false) => s.replace(ANSI, '').replace(keepLines ? CTRL_KEEP_LINES : CTRL, '')

// ponytail: a path outside the cwd stays absolute; no `../` walk.
export function relPath(file: string, cwd: string) {
  const f = cleanText(file)
  const base = cwd.replace(/\/+$/, '')
  return base !== '' && f.startsWith(`${base}/`) ? f.slice(base.length + 1) : f
}

// Lines of a text as a diff counts them: a trailing newline does not add one.
export const countLines = (s: string) => (s === '' ? 0 : s.replace(/\n$/, '').split('\n').length)

export type Touch = { path: string; kind: 'read' | 'edit'; add: number; del: number }

// Adds a touch to the files record (new object), dropping the oldest-touched past MAX_FILES.
export function touch(files: Record<string, Entry>, t: Touch, seq: number): Record<string, Entry> {
  const prev = files[t.path]
  const next = {
    ...files,
    [t.path]: {
      path: t.path,
      kind: t.kind === 'edit' || prev?.kind === 'edit' ? ('edit' as const) : ('read' as const),
      add: (prev?.add ?? 0) + t.add,
      del: (prev?.del ?? 0) + t.del,
      seq,
    },
  }
  const keys = Object.keys(next)
  if (keys.length > MAX_FILES) {
    keys.sort((a, b) => next[a]!.seq - next[b]!.seq)
    for (const k of keys.slice(0, keys.length - MAX_FILES)) delete next[k]
  }
  return next
}

export type Row = { key: string; prefix: string; name: string; isDir: boolean; entry?: Entry }
type Node = { name: string; kids: Map<string, Node>; entry?: Entry }

// The tree as rows to draw: directories first, then files, each group sorted by name; Unicode guides.
export function buildRows(files: Record<string, Entry>): Row[] {
  const root: Node = { name: '', kids: new Map() }
  for (const entry of Object.values(files)) {
    const segs = entry.path.split('/').filter(Boolean)
    if (entry.path.startsWith('/') && segs.length > 0) segs[0] = `/${segs[0]}`
    let node = root
    segs.forEach((seg, i) => {
      let kid = node.kids.get(seg)
      if (!kid) node.kids.set(seg, (kid = { name: seg, kids: new Map() }))
      if (i === segs.length - 1) kid.entry = entry
      node = kid
    })
  }
  const rows: Row[] = []
  const walk = (node: Node, guide: string, path: string) => {
    const kids = [...node.kids.values()].sort((a, b) => {
      const da = a.entry === undefined || a.kids.size > 0 ? 0 : 1
      const db = b.entry === undefined || b.kids.size > 0 ? 0 : 1
      return da - db || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    })
    kids.forEach((kid, i) => {
      const last = i === kids.length - 1
      const key = `${path}/${kid.name}`
      const isDir = kid.entry === undefined || kid.kids.size > 0
      rows.push({ key, prefix: guide + (last ? '└─ ' : '├─ '), name: isDir ? `${kid.name}/` : kid.name, isDir, entry: isDir ? undefined : kid.entry })
      walk(kid, guide + (last ? '   ' : '│  '), key)
    })
  }
  walk(root, '', '')
  return rows
}
