import type { StatusSnapshot } from '../types'
import {
  backgroundPill, BAR_WIDTH, barFill, cacheState, colorFor, type Detail, fmtDuration, fmtTokens, prettyModel, STATUS_CYAN,
  STATUS_GREEN, STATUS_RED, statsWidth,
} from './status'

// Room the engine's own mode label takes left of the hint row (⏵⏵ auto mode on · ).
const MODE_LABEL_COLUMNS = 22

type Ui = { Box: any; Text: any; Button: any }

// The status line: model, folder and branch, context, 5h/7d limits and cache, then the optional button; under it,
// while Claude has a background shell or monitor running, the engine's pill for them.
export function statusRow(
  { Box, Text, Button }: Ui,
  p: {
    snapshot: StatusSnapshot
    clock: number
    lastResponseAt: number | null
    columns: number
    label: string // text of the button, '' when there is none
    hint: string
    button: unknown // undefined when there is none
    onPill: () => unknown
  },
) {
  const { snapshot, clock } = p
  const cache = cacheState(p.lastResponseAt, clock)
  const sep = <Text dimColor>{'  │  '}</Text>
  const bar = (percent: number, color: string) => (
    <Text>
      <Text color={color}>{'█'.repeat(barFill(percent))}</Text>
      <Text dimColor>{'░'.repeat(BAR_WIDTH - barFill(percent))}</Text>{' '}
    </Text>
  )

  const ctxPercent = Math.round(snapshot.ctxPercent ?? 0)
  const ctxTokens =
    snapshot.ctxTokens === null ? '' : ` ${fmtTokens(snapshot.ctxTokens)}${snapshot.ctxWindow ? `/${fmtTokens(snapshot.ctxWindow)}` : ''}`
  const limits = snapshot.limits.map(l => ({
    ...l,
    percentText: `${l.percent}%`,
    resetText: l.resetsAt === null ? '' : ` (resets ${fmtDuration(l.resetsAt - clock)})`,
  }))
  const cacheText = cache === null ? '' : `● cache ${cache}`
  const model = prettyModel(snapshot.model)
  const head = `${model} · ${snapshot.dir}${snapshot.branch === '' ? '' : ` · ${snapshot.branch}`}`
  // One row beside the engine's mode label: the most detailed level that leaves room for the button; past the
  // least detailed one, the model and folder go too.
  const room = p.columns - MODE_LABEL_COLUMNS - p.label.length - 4
  const fits = (d: Detail, withHead: boolean) =>
    statsWidth(`${ctxPercent}%${ctxTokens}`, limits, cacheText, d) + (withHead ? head.length + 5 : 0) <= room
  const showHead = fits(2, true)
  const detail: Detail = ([0, 1, 2] as const).find(d => fits(d, showHead)) ?? 2

  const stats = [
    showHead && (
      <Text key="head">
        <Text color={STATUS_CYAN}>{model}</Text>
        <Text dimColor> · </Text>
        <Text>{snapshot.dir}</Text>
        {snapshot.branch !== '' && <Text dimColor> · </Text>}
        {snapshot.branch !== '' && <Text color={STATUS_GREEN}>{snapshot.branch}</Text>}
        {sep}
      </Text>
    ),
    <Text key="ctx">
      <Text>ctx </Text>
      {detail === 0 && bar(ctxPercent, colorFor(ctxPercent))}
      <Text bold color={colorFor(ctxPercent)}>{`${ctxPercent}%`}</Text>
      <Text dimColor>{ctxTokens}</Text>
    </Text>,
    ...limits.map(l => (
      <Text key={`limit-${l.label}`}>
        {sep}
        <Text>{l.label} </Text>
        {detail === 0 && bar(l.percent, colorFor(l.percent))}
        <Text bold color={colorFor(l.percent)}>{l.percentText}</Text>
        {detail < 2 && <Text dimColor>{l.resetText}</Text>}
      </Text>
    )),
    cache !== null && (
      <Text key="cache">
        {sep}
        <Text color={cache === 'ok' ? STATUS_GREEN : STATUS_RED}>●</Text>
        <Text dimColor> cache {cache}</Text>
      </Text>
    ),
  ]

  const statsRow = (
    <Box justifyContent="space-between" flexGrow={1} gap={1}>
      <Text wrap="truncate">{stats}</Text>
      {p.button ?? null}
    </Box>
  )
  const pill = backgroundPill(p.hint)
  if (pill === null) return statsRow
  return (
    <Box flexDirection="column" flexGrow={1}>
      {statsRow}
      <Box gap={1}>
        <Button key="background-tasks" plain label={`⎿ ${pill}`} onPress={p.onPill} />
        <Text dimColor wrap="truncate">
          · /tasks to manage
        </Text>
      </Box>
    </Box>
  )
}

// The settings page: On/Off. In the menu's pane it carries a back button (key mods-back), whose press the menu handles.
export function statusPage({ Box, Text, Button }: Ui, p: { isOn: boolean; hasBack: boolean; onSet: (v: boolean) => unknown; onBack: () => unknown }) {
  const option = (key: string, label: string, isOn: boolean, onPress: () => unknown) => (
    <Box key={`row-${key}`} gap={1}>
      <Button key={key} plain label={`${isOn ? '●' : '○'} ${label}`} dimColor={!isOn} onPress={onPress} />
    </Box>
  )
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="claude">
          ◆ Status line
        </Text>
        {p.hasBack && <Button key="mods-back" plain dimColor hotkey="b" label="← back" onPress={p.onBack} />}
      </Box>
      <Text dimColor>Model, folder and branch, then context, 5h and 7d limits and cache.</Text>
      <Box marginTop={1}>
        <Text bold>Status line</Text>
      </Box>
      {option('status-on', 'On', p.isOn, () => p.onSet(true))}
      {option('status-off', 'Off', !p.isOn, () => p.onSet(false))}
      <Text dimColor>On takes your own statusLine out of settings.json; Off puts it back.</Text>
      <Box marginTop={1}>
        <Text dimColor>↑↓ move · enter select · esc close</Text>
      </Box>
    </Box>
  )
}
