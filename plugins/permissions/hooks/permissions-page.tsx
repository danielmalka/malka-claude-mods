import { MODES, modeLabel, type Mode } from './modes'

export const BYPASS_WARNING = 'Bypass skips every permission check in every new session.'

type Ui = { Box: any; Text: any; Button: any }

// The Permissions page: the running mode (shown only) and the mode new sessions start in, one item per row.
export function permissionsPage(
  { Box, Text, Button }: Ui,
  p: {
    hasBack: boolean
    defaultMode: string
    onMode: (mode: Mode) => unknown
    onBack: () => unknown
  },
) {
  const heading = (text: string) => (
    <Box key={`h-${text}`} marginTop={1}>
      <Text bold>{text}</Text>
    </Box>
  )
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="claude">
          ◆ Permissions
        </Text>
        {p.hasBack && <Button key="mods-back" plain dimColor hotkey="b" label="← back" onPress={p.onBack} />}
      </Box>
      <Text dimColor>The permission mode new sessions start in.</Text>
      {heading('Running in')}
      {/* The engine gives mods no permission-mode event or getter, so the running mode is unknown. */}
      <Text key="mode-running">
        unknown
        <Text dimColor> · shift+tab switches it</Text>
      </Text>
      {heading('New sessions start in')}
      {MODES.map(m => (
        <Box key={`row-default-mode-${m}`} gap={1}>
          <Button key={`default-mode-${m}`} plain label={`${m === p.defaultMode ? '●' : '○'} ${modeLabel(m)}`} dimColor={m !== p.defaultMode} onPress={() => p.onMode(m)} />
        </Box>
      ))}
      {p.defaultMode === 'bypassPermissions' && (
        <Text key="mode-warning" color="warning">
          {BYPASS_WARNING}
        </Text>
      )}
      <Text dimColor>Project or local settings can override this for a given folder.</Text>
      <Box marginTop={1}>
        <Text dimColor>↑↓ move · enter select · esc close</Text>
      </Box>
    </Box>
  )
}
