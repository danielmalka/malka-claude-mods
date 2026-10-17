import type { Summary } from '../types'
import { rowView } from './rows'
import type { Row } from './tree'

type Ui = { Box: any; Text: any; Button: any }

export type TreeActions = {
  onToggle: (key: string) => unknown
  onCollapse: () => unknown
  onExpand: () => unknown
  onReads: () => unknown
  onTree: () => unknown
  onSummary: () => unknown
  onFollow: () => unknown
}

// The side pane: header buttons, the tree of touched files, then one summary per finished turn (the pane's own scroll moves it all).
export function treePage(
  ui: Ui,
  p: {
    title: string
    rows: Row[]
    fileCount: number
    inflight: string[]
    shimmer: boolean
    summaries: Summary[]
    treeHidden: boolean
    summaryHidden: boolean
    readsHidden: boolean
    manual: boolean
    act: TreeActions
  },
) {
  const { Box, Text, Button } = ui
  const { act } = p
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="claude" wrap="truncate">
        {p.title}
      </Text>
      <Box flexWrap="wrap" columnGap={2}>
        <Button key="hk-c" plain hotkey="c" label="fold" onPress={act.onCollapse} />
        <Button key="hk-e" plain hotkey="e" label="unfold" onPress={act.onExpand} />
        <Button key="hk-r" plain hotkey="r" label={p.readsHidden ? 'show reads' : 'hide reads'} onPress={act.onReads} />
        <Button key="hk-t" plain hotkey="t" label="files" onPress={act.onTree} />
        <Button key="hk-s" plain hotkey="s" label="summary" onPress={act.onSummary} />
        {p.manual && <Button key="hk-f" plain hotkey="f" label="follow" onPress={act.onFollow} />}
      </Box>
      <Text bold>
        {p.treeHidden ? '▸' : '▾'} files ({p.fileCount})
      </Text>
      {!p.treeHidden && p.rows.length === 0 && <Text dimColor>{p.fileCount === 0 ? 'No files touched yet.' : 'Only read files, hidden (r).'}</Text>}
      {!p.treeHidden && p.rows.map(r => rowView(ui, r, { inflight: p.inflight, shimmer: p.shimmer, onToggle: act.onToggle }))}
      <Box marginTop={1}>
        <Text bold>
          {p.summaryHidden ? '▸' : '▾'} summary ({p.summaries.length})
        </Text>
      </Box>
      {!p.summaryHidden && p.summaries.length === 0 && <Text dimColor>Nothing yet: a summary appears when a turn changes files.</Text>}
      {!p.summaryHidden &&
        p.summaries.map(s => (
          <Box key={`sum-${s.turn}`} flexDirection="column" marginTop={1}>
            <Text dimColor>turn {s.turn}{s.isFallback ? ' · files only' : ''}</Text>
            <Text>{s.text}</Text>
          </Box>
        ))}
      <Box marginTop={1}>
        <Text dimColor>↑↓ scroll · esc close</Text>
      </Box>
    </Box>
  )
}

// The page inside the menu's pane: the switch, the language and `← back`.
export function settingsPage(
  { Box, Text, Button }: Ui,
  p: { isOn: boolean; lang: string | null; onToggle: () => unknown; onBack: () => unknown },
) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="claude">
          ◆ tree-explained
        </Text>
        <Button key="mods-back" plain dimColor hotkey="b" label="← back" onPress={p.onBack} />
      </Box>
      <Text dimColor>A pane with the files Claude touched and a summary of each turn.</Text>
      <Box marginTop={1}>
        <Button key="toggle" plain autoFocus label={`${p.isOn ? '●' : '○'} ${p.isOn ? 'on' : 'off'}`} onPress={p.onToggle} />
      </Box>
      <Box marginTop={1}>
        <Text>Summary language: {p.lang ?? 'follows your first prompt'}</Text>
      </Box>
      <Text dimColor>Change it with /tree-explained lang {'<language>'} or lang auto.</Text>
      <Box marginTop={1}>
        <Text dimColor>enter select · esc close</Text>
      </Box>
    </Box>
  )
}
