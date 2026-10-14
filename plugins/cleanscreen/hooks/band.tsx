import type { CleanColors, CleanTask, CleanTheme } from '../types'
import { barCells, elapsed, percentOf, stepLabel, visibleSteps } from './clean'

// Clean screen's progress band.
export function cleanBand(
  { Box, Text, Button }: { Box: any; Text: any; Button: any },
  p: { t: CleanTask; theme: CleanTheme; colors: CleanColors; isCollapsed: boolean; clock: number; columns: number; onToggle: () => unknown },
) {
  const { t, theme, colors, isCollapsed } = p
  const percent = percentOf(t)
  const mark = t.doneAt !== null ? '✓' : '✶'
  const width = Math.max(8, p.columns - 4 - 16 - 6 - (isCollapsed ? Math.min(30, t.title.length + 2) : 0))
  const { filled, runs } = barCells(theme, colors.bar, width, percent)
  const bar = (
    <Box>
      {runs.map(r => (
        <Text color={r.color}>{'█'.repeat(r.cells)}</Text>
      ))}
      <Text dimColor>{'░'.repeat(width - filled)}</Text>
    </Box>
  )
  const toggle = <Button key="cs-collapse" plain dimColor label={isCollapsed ? '[+]' : '[–]'} onPress={p.onToggle} />

  if (isCollapsed) {
    return (
      <Box borderStyle="round" borderColor={colors.border} paddingX={1} gap={1}>
        <Box width={Math.min(30, t.title.length + 2)}>
          <Text color={colors.text} bold wrap="truncate">
            {mark} {t.title}
          </Text>
        </Box>
        {bar}
        <Text color={colors.text} bold>{`${percent}%`.padStart(4)}</Text>
        {toggle}
      </Box>
    )
  }

  const shown = visibleSteps(t)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.border} paddingX={1}>
      <Box justifyContent="space-between" gap={1}>
        <Text color={colors.text} bold wrap="truncate">
          {mark} {t.title}
        </Text>
        <Box gap={1} flexShrink={0}>
          <Text dimColor>{elapsed((t.doneAt ?? p.clock) - t.startedAt)}</Text>
          {toggle}
        </Box>
      </Box>
      <Box gap={1}>
        <Text dimColor>{stepLabel(t).padEnd(14)}</Text>
        {bar}
        <Text color={colors.text} bold>{`${percent}%`.padStart(4)}</Text>
      </Box>
      {shown.map(step => {
        const isNow = step.status === 'in_progress'
        return (
          <Box key={`step-${step.id}`} justifyContent="space-between" gap={1}>
            <Text color={isNow ? colors.text : undefined} bold={isNow} dimColor={step.status === 'pending'} wrap="truncate">
              {step.status === 'completed' ? '●' : isNow ? '◉' : '○'} {step.text}
            </Text>
            <Text color={isNow ? colors.text : undefined} dimColor={!isNow}>
              {step.status === 'completed' ? 'Done' : isNow ? 'Working' : 'Next'}
            </Text>
          </Box>
        )
      })}
      {t.steps.length > shown.length && <Text dimColor>{t.steps.length - shown.length} more</Text>}
    </Box>
  )
}
