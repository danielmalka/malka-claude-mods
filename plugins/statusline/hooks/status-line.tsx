import type { StatusSnapshot } from '../types'
import { cacheState, colorFor, fmtDuration, fmtTokens, pickLayout, prettyModel, STATUS_CYAN, STATUS_GREEN, STATUS_RED } from './status'

type Ui = { Box: any; Text: any; Button: any }

// The status band: ctx, 5h/7d and cache, then model · folder · branch, as atomic segments that wrap onto further rows
// (never cut, never dropped); the optional button joins the last row or sits right-aligned on its own.
export function statusBand(
  { Box, Text }: Ui,
  p: {
    snapshot: StatusSnapshot
    clock: number
    lastResponseAt: number | null
    columns: number
    label: string // text of the button, '' when there is none
    button: unknown // undefined when there is none
  },
) {
  const { snapshot, clock } = p
  const cache = cacheState(p.lastResponseAt, clock)
  const ctxPercent = Math.round(snapshot.ctxPercent ?? 0)
  const ctxTokens =
    snapshot.ctxTokens === null ? '' : ` ${fmtTokens(snapshot.ctxTokens)}${snapshot.ctxWindow ? `/${fmtTokens(snapshot.ctxWindow)}` : ''}`
  const limits = snapshot.limits.map(l => ({
    ...l,
    percentText: `${l.percent}%`,
    resetText: l.resetsAt === null ? '' : ` (resets ${fmtDuration(l.resetsAt - clock)})`,
  }))
  const model = prettyModel(snapshot.model)
  const head = `${model} · ${snapshot.dir}${snapshot.branch === '' ? '' : ` · ${snapshot.branch}`}`
  const buttonWidth = p.button === undefined ? 0 : [...p.label].length
  const { segments, rows, buttonJoins } = pickLayout(
    { ctxText: `${ctxPercent}%${ctxTokens}`, limits, cacheText: cache === null ? '' : `● cache ${cache}`, head },
    p.columns,
    buttonWidth,
  )

  const drawn: Record<string, unknown> = {
    ctx: (
      <Text key="seg-ctx">
        <Text>ctx </Text>
        <Text bold color={colorFor(ctxPercent)}>{`${ctxPercent}%`}</Text>
        <Text dimColor>{ctxTokens}</Text>
      </Text>
    ),
    head: (
      <Text key="seg-head">
        <Text color={STATUS_CYAN}>{model}</Text>
        <Text dimColor> · </Text>
        <Text>{snapshot.dir}</Text>
        {snapshot.branch !== '' && <Text dimColor> · </Text>}
        {snapshot.branch !== '' && <Text color={STATUS_GREEN}>{snapshot.branch}</Text>}
      </Text>
    ),
  }
  for (const l of limits)
    drawn[`limit-${l.label}`] = (
      <Text key={`seg-limit-${l.label}`}>
        <Text>{l.label} </Text>
        <Text bold color={colorFor(l.percent)}>{l.percentText}</Text>
        <Text dimColor>{l.resetText}</Text>
      </Text>
    )
  if (cache !== null)
    drawn.cache = (
      <Text key="seg-cache">
        <Text color={cache === 'ok' ? STATUS_GREEN : STATUS_RED}>●</Text>
        <Text dimColor> cache {cache}</Text>
      </Text>
    )

  const lastRow = rows.length - 1
  return (
    <Box flexDirection="column">
      {rows.map((row, r) => {
        const cells = row.flatMap((i, n) => [
          ...(n === 0 ? [] : [<Text key={`sep-${r}-${n}`} dimColor>{'  │  '}</Text>]),
          drawn[segments[i]!.key],
        ])
        return (
          <Box key={`row-${r}`} justifyContent="space-between" gap={1}>
            <Box>{cells}</Box>
            {r === lastRow && buttonJoins ? p.button : null}
          </Box>
        )
      })}
      {p.button !== undefined && !buttonJoins && (
        <Box key="row-button" justifyContent="flex-end">
          {p.button}
        </Box>
      )}
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
