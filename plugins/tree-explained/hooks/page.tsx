import type { Summary } from '../types'
import type { Row } from './tree'

type Ui = { Box: any; Text: any; Button: any }

const EDIT = '#ff9e3b'
const EDIT_GLOW = '#ffd08a'
const READ = '#a78bfa'
const ADD = '#4ade80'
const DEL = '#f87171'

// The side pane: the tree of touched files, then one summary per finished turn (the pane's own scroll moves it all).
export function treePage(
  { Box, Text }: Ui,
  p: { title: string; rows: Row[]; inflight: string[]; shimmer: boolean; summaries: Summary[] },
) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="claude" wrap="truncate">
        {p.title}
      </Text>
      {p.rows.length === 0 && <Text dimColor>No files touched yet.</Text>}
      {p.rows.map(r => {
        const e = r.entry
        if (e === undefined) {
          return (
            <Text key={`row-${r.key}`} wrap="truncate">
              <Text dimColor>{r.prefix}</Text>
              <Text bold>{r.name}</Text>
            </Text>
          )
        }
        const live = p.inflight.includes(e.path)
        const base = e.kind === 'edit' ? EDIT : READ
        return (
          <Text key={`row-${r.key}`} wrap="truncate">
            <Text dimColor>{r.prefix}</Text>
            <Text color={live && p.shimmer ? EDIT_GLOW : base} bold={live} dimColor={e.kind === 'read' && !live}>
              {r.name}
            </Text>
            {e.add > 0 && <Text color={ADD}> +{e.add}</Text>}
            {e.del > 0 && <Text color={DEL}> -{e.del}</Text>}
          </Text>
        )
      })}
      <Box marginTop={1}>
        <Text bold>summary</Text>
      </Box>
      {p.summaries.length === 0 && <Text dimColor>Nothing yet: a summary appears when a turn changes files.</Text>}
      {p.summaries.map(s => (
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
