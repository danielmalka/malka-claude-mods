// The status line's arithmetic. Pure; drawing is in status-line.tsx, data gathering in register.tsx.
export const STATUS_GREEN = '#22c55e'
export const STATUS_YELLOW = '#eab308'
export const STATUS_RED = '#ef4444'
export const STATUS_CYAN = '#22d3ee'

// Claude Code's main-thread prompt cache lives for an hour on a subscription.
export const CACHE_TTL_MS = 60 * 60 * 1000

export const colorFor = (percent: number): string =>
  percent >= 90 ? STATUS_RED : percent >= 70 ? STATUS_YELLOW : STATUS_GREEN

export const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

// Short countdown: 45s, 12m, 4h38m, 5d18h.
export const fmtDuration = (ms: number): string => {
  const secs = Math.max(0, Math.floor(ms / 1000))
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, '0')}h`
}

// "ok" while the last response is younger than the cache, "over" after; null before the first response.
export const cacheState = (lastResponseAt: number | null, now: number): 'ok' | 'over' | null =>
  lastResponseAt === null ? null : now - lastResponseAt < CACHE_TTL_MS ? 'ok' : 'over'

export const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

// Layout. The band is made of atomic segments, in priority order: ctx, 5h, 7d, cache, then the head
// (model · folder · branch). A segment is never split or dropped; a row that cannot hold the next one wraps.
export type Segment = { key: string; text: string }

export type StatusParts = {
  ctxText: string // `41% 82k/200k`
  limits: readonly { label: string; percentText: string; resetText: string }[]
  cacheText: string // '' = no cache segment
  head: string
}

// The same strings the band draws. Text only: the status line never draws progress bars.
export const segmentTexts = (d: StatusParts): Segment[] => {
  return [
    { key: 'ctx', text: `ctx ${d.ctxText}` },
    ...d.limits.map(l => ({ key: `limit-${l.label}`, text: `${l.label} ${l.percentText}${l.resetText}` })),
    ...(d.cacheText === '' ? [] : [{ key: 'cache', text: d.cacheText }]),
    { key: 'head', text: d.head },
  ]
}

export const SEP_WIDTH = 5 // `  │  `, drawn only between two segments of one row
const BUTTON_GAP = 1

// Indices per row, greedy, in order. Every index appears once; one wider than the row stays alone (its Text wraps).
// The button joins the last row when gap + button fits, else it takes a row of its own.
export function layoutRows(widths: readonly number[], columns: number, sep: number, button: number): { rows: number[][]; buttonJoins: boolean } {
  const rows: number[][] = []
  let used = 0
  widths.forEach((w, i) => {
    const row = rows[rows.length - 1]
    if (row !== undefined && used + sep + w <= columns) {
      row.push(i)
      used += sep + w
    } else {
      rows.push([i])
      used = w
    }
  })
  return { rows, buttonJoins: button > 0 && rows.length > 0 && used + BUTTON_GAP + button <= columns }
}

export const rowCount = (l: { rows: unknown[]; buttonJoins: boolean }, button: number): number =>
  l.rows.length + (button > 0 && !l.buttonJoins ? 1 : 0)

// Resets and head are never dropped.
export function pickLayout(d: StatusParts, columns: number, button: number) {
  const segments = segmentTexts(d)
  return { segments, ...layoutRows(segments.map(s => [...s.text].length), columns, SEP_WIDTH, button) }
}

// `claude-opus-5-5` as `Opus 5.5`; a name that is not a Claude model id stays as it is.
export function prettyModel(id: string): string {
  const match = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/i)
  if (match === null) return id
  const [, family = '', major = '', minor] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor === undefined ? '' : `.${minor}`}`
}
