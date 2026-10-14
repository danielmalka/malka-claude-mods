// Clean screen's look and arithmetic. Pure; the hooks are in register.tsx.
import type { CleanColors, CleanStep, CleanTask, CleanTheme, StepStatus } from '../types'

export const THEMES: readonly CleanTheme[] = ['blue', 'dark', 'light', 'green', 'rainbow', 'custom']

export const RAINBOW = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899']

const PRESETS: Record<Exclude<CleanTheme, 'custom'>, CleanColors> = {
  blue: { bar: '#3b82f6', text: '#bfdbfe', border: '#3b82f6' },
  dark: { bar: '#e5e7eb', text: '#d1d5db', border: '#6b7280' },
  light: { bar: '#2563eb', text: '#1f2937', border: '#9ca3af' },
  green: { bar: '#22c55e', text: '#bbf7d0', border: '#16a34a' },
  rainbow: { bar: '#ef4444', text: '#f9a8d4', border: '#ec4899' },
}

export const DEFAULT_CUSTOM: CleanColors = { bar: '#3b82f6', text: '#e2e8f0', border: '#3b82f6' }

export const TOOL_NAME = 'cleanscreen_progress'
// The name the model calls it by: mcp__<plugin>__<name>.
export const TOOL = `mcp__cleanscreen__${TOOL_NAME}`

export const PROMPT = [
  'Clean screen is on: the user sees only your text messages, not your tool calls or their output.',
  `They follow your work on a progress band fed by the ${TOOL_NAME} tool (${TOOL}).`,
  'Before you start, call it with your plan as a list of short steps. Call it again with the whole list each time a step starts or finishes,',
  'so exactly one step is in_progress while you work and every step is completed when you are done.',
  'Before acting, say in a sentence what you are about to do and why.',
].join(' ')

export const TOOL_DESCRIPTION =
  'Updates the Clean screen progress band the user watches. Send your whole plan each call: every step with its status ' +
  '(pending, in_progress or completed). Call it when you start a task and whenever a step starts or finishes.'

export const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Optional short name for the whole task.' },
    steps: {
      type: 'array',
      description: 'The full plan, in order.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The step, in a few words.' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
        },
        required: ['text', 'status'],
      },
    },
  },
  required: ['steps'],
}

export const colorsFor = (theme: CleanTheme, custom: CleanColors): CleanColors => (theme === 'custom' ? custom : PRESETS[theme])

export const percentOf = (t: CleanTask): number => {
  if (t.doneAt !== null) return 100
  if (t.steps.length === 0) return 0
  return Math.round((t.steps.filter(s => s.status === 'completed').length / t.steps.length) * 100)
}

const STATUSES: readonly StepStatus[] = ['pending', 'in_progress', 'completed']
export const asStatus = (s: unknown): StepStatus => (STATUSES.includes(s as StepStatus) ? (s as StepStatus) : 'pending')

export const elapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export const stepLabel = (t: CleanTask): string => {
  if (t.doneAt !== null) return 'Done'
  if (t.steps.length === 0) return 'Working…'
  const current = t.steps.findIndex(s => s.status === 'in_progress')
  const done = t.steps.filter(s => s.status === 'completed').length
  return `Step ${Math.min(t.steps.length, (current >= 0 ? current : done) + 1)} of ${t.steps.length}`
}

// How many cells of each color a bar `width` wide fills at `percent`.
export const barCells = (theme: CleanTheme, bar: string, width: number, percent: number) => {
  const filled = Math.round((width * Math.max(0, Math.min(100, percent))) / 100)
  if (theme !== 'rainbow') return { filled, runs: filled > 0 ? [{ color: bar, cells: filled }] : [] }
  const runs = RAINBOW.map((color, i) => {
    const from = Math.floor((width * i) / RAINBOW.length)
    const to = Math.floor((width * (i + 1)) / RAINBOW.length)
    return { color, cells: Math.max(0, Math.min(to, filled) - from) }
  }).filter(r => r.cells > 0)
  return { filled, runs }
}

// At most `room` steps, keeping the current one in view.
export const visibleSteps = (t: CleanTask, room = 6) => {
  const current = t.steps.findIndex(s => s.status === 'in_progress')
  const first = Math.max(0, Math.min(current - 2, t.steps.length - room))
  return t.steps.slice(first, first + room)
}

// What the model sends is untrusted and drawn on the terminal: control characters go, text is trimmed, sizes capped.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g
export const TEXT_MAX = 200
export const STEPS_MAX = 50
export const cleanText = (v: unknown, max = TEXT_MAX): string =>
  typeof v === 'string' ? v.replace(CONTROL, '').trim().slice(0, max) : ''

export const parseInput = (input: unknown): { title: string; steps: CleanStep[] } => {
  const o = input && typeof input === 'object' ? (input as { title?: unknown; steps?: unknown }) : {}
  const steps: CleanStep[] = []
  for (const [i, raw] of (Array.isArray(o.steps) ? o.steps.slice(0, STEPS_MAX) : []).entries()) {
    if (raw === null || typeof raw !== 'object') continue
    const text = cleanText((raw as { text?: unknown }).text)
    if (text !== '') steps.push({ id: `cs-${i}`, text, status: asStatus((raw as { status?: unknown }).status) })
  }
  return { title: cleanText(o.title), steps }
}

// TodoWrite / TaskCreate / TaskUpdate as band steps.
export const todoSteps = (todos: { content: string; activeForm?: string; status: string }[]): CleanStep[] =>
  todos.slice(0, STEPS_MAX).map((todo, i) => ({
    id: `todo-${i}`,
    text: cleanText(todo.status === 'in_progress' ? todo.activeForm || todo.content : todo.content),
    status: asStatus(todo.status),
  })).filter(s => s.text !== '')

export const addStep = (steps: CleanStep[], id: string, subject: string): CleanStep[] =>
  cleanText(subject) === ''
    ? steps
    : [...steps.filter(s => s.id !== id), { id, text: cleanText(subject), status: 'pending' as const }].slice(0, STEPS_MAX)

export const updateSteps = (steps: CleanStep[], e: { taskId: string; subject?: string; status?: string }): CleanStep[] =>
  e.status === 'deleted'
    ? steps.filter(s => s.id !== e.taskId)
    : steps.map(s =>
        s.id === e.taskId ? { ...s, text: e.subject ? cleanText(e.subject) : s.text, status: e.status ? asStatus(e.status) : s.status } : s,
      ).filter(s => s.text !== '')

export const HEX = /^#[0-9a-f]{6}$/i

// The instruction a prompt carries: a prompt the user typed (terminal or Remote Control), not a slash command, while on.
export const contextFor = (originKind: string | undefined, text: unknown, isOn: boolean): readonly string[] => {
  const t = String(text ?? '').trim()
  return isOn && (originKind === 'composer' || originKind === 'bridge') && t !== '' && !t.startsWith('/') ? [PROMPT] : []
}
