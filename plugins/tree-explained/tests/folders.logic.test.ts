import { expect, test } from 'claude-code/testing'

import { allFolders, ancestors, buildRows, inside, locate, openAll, OUTSIDE, touch } from '../hooks/tree'

const mk = (list: [string, 'read' | 'edit', number?, number?, boolean?][]) => {
  let files = {}
  let n = 0
  for (const [path, kind, add = 0, del = 0, outside] of list) files = touch(files, { path, kind, add, del, outside }, ++n)
  return files
}
const label = (rows: ReturnType<typeof buildRows>) => rows.map(r => r.prefix + r.name + (r.suffix ? ` ${r.suffix}` : ''))

const sample = mk([
  ['src/a.ts', 'edit', 3, 1],
  ['src/lib/x.ts', 'edit', 2, 0],
  ['src/lib/y.ts', 'read'],
  ['docs/r.md', 'read'],
  ['top.ts', 'read'],
])

test('buildRows: everything is closed by default, with counts and sums on the folder', () => {
  const rows = buildRows(sample)
  expect(label(rows)).toEqual(['├─ docs/ (1 read)', '├─ src/ (2 edits, 1 read)', '└─ top.ts'])
  const src = rows.find(r => r.name === 'src/')!
  expect([src.isOpen, src.hasKids, src.edits, src.reads, src.add, src.del]).toEqual([false, true, 2, 1, 5, 1])
})

test('buildRows: an open set shows the children of those folders only', () => {
  expect(label(buildRows(sample, ['src']))).toEqual(['├─ docs/ (1 read)', '├─ src/', '│  ├─ lib/ (1 edit, 1 read)', '│  └─ a.ts', '└─ top.ts'])
  expect(buildRows(sample, ['src', 'src/lib']).map(r => r.name)).toEqual(['docs/', 'src/', 'lib/', 'x.ts', 'y.ts', 'a.ts', 'top.ts'])
  // a child of a closed folder stays hidden even when its own key is open
  expect(buildRows(sample, ['src/lib']).map(r => r.name)).toEqual(['docs/', 'src/', 'top.ts'])
})

test('buildRows: collapse all is an empty set, expand all opens every folder', () => {
  expect(buildRows(sample, allFolders(sample)).length).toBe(8)
  expect(allFolders(sample).sort()).toEqual(['docs', 'src', 'src/lib'])
  expect(buildRows(sample, []).length).toBe(3)
})

test('buildRows: hide reads drops read-only files and the folders left empty', () => {
  const rows = buildRows(sample, ['src', 'src/lib', 'docs'], true)
  expect(rows.map(r => r.name)).toEqual(['src/', 'lib/', 'x.ts', 'a.ts'])
  expect(label(buildRows(sample, [], true))).toEqual(['└─ src/ (2 edits)'])
})

test('open-on-edit helpers: ancestors, union keeps what was open', () => {
  expect(ancestors('src/lib/x.ts')).toEqual(['src', 'src/lib'])
  expect(ancestors('top.ts')).toEqual([])
  expect(ancestors('/opt/lib/x.ts', true)).toEqual([OUTSIDE])
  expect(openAll(['docs'], ['src', 'docs'])).toEqual(['docs', 'src'])
})

test('inside: whole segments, `..`, trailing slashes, equal path', () => {
  expect(inside('/proj', '/proj/a.ts')).toBe(true)
  expect(inside('/proj/', '/proj/a.ts')).toBe(true)
  expect(inside('/proj', '/proj')).toBe(true)
  expect(inside('/proj', '/proj-other/x')).toBe(false)
  expect(inside('/proj', '/proj/../etc/x')).toBe(false)
  expect(inside('/proj', '/proj/a/../b.ts')).toBe(true)
  expect(inside('/proj', 'src/a.ts')).toBe(true)
  expect(inside('/proj', '../x.ts')).toBe(false)
  expect(inside('', '/anything')).toBe(true)
  expect(locate('/opt/lib/x.ts', '/proj')).toEqual({ path: '/opt/lib/x.ts', outside: true })
  expect(locate('/proj/src/../src/a.ts', '/proj/')).toEqual({ path: 'src/a.ts', outside: false })
})

test('outside files: one closed row with the count, flat `parent/file` labels when open, last in the tree', () => {
  const files = mk([
    ['src/a.ts', 'edit', 1, 0],
    ['/opt/lib/deep/x.ts', 'read', 0, 0, true],
    ['/tmp/t/y.ts', 'edit', 4, 2, true],
  ])
  expect(label(buildRows(files))).toEqual(['├─ src/ (1 edit)', '└─ (outside project) (2 files, 1 edit, 1 read)'])
  const closed = buildRows(files).at(-1)!
  expect([closed.add, closed.del, closed.key]).toEqual([4, 2, OUTSIDE])
  const open = buildRows(files, [OUTSIDE])
  expect(open.map(r => r.name)).toEqual(['src/', '(outside project)', 'deep/x.ts', 't/y.ts'])
  expect(open.filter(r => r.entry).every(r => !r.name.startsWith('/'))).toBe(true)
  expect(buildRows(files, [OUTSIDE], true).map(r => r.name)).toEqual(['src/', '(outside project)', 't/y.ts'])
})
