import type { EngineInterface } from 'claude-code'

const THRESHOLDS = [60, 80] as const
const MESSAGES: Record<number, (p: number) => string> = {
  60: p => `Context at ${p}% - consider /compact at the next pause`,
  80: p => `Context at ${p}% - time to /compact`,
}

// Thresholds already warned this session (module-level; session.start clears it).
// One session per plugin instance; a plugin reload re-warns once.
const warned = new Set<number>()

export const resetContextToasts = () => warned.clear()

// Fail-open: any error is swallowed. Independent of the status line on/off.
export async function checkContext($: EngineInterface): Promise<void> {
  try {
    const percent = (await $.session.usage()).context.percent
    if (typeof percent !== 'number') return
    // a reading crossing several thresholds at once shows only the highest; lower ones count as warned
    const crossed = THRESHOLDS.filter(t => percent >= t)
    const top = crossed[crossed.length - 1]
    if (top === undefined) return
    const isNew = !warned.has(top)
    for (const t of crossed) warned.add(t)
    if (isNew) $.ui.toast(MESSAGES[top]!(Math.round(percent)))
  } catch {
    // ignore
  }
}
