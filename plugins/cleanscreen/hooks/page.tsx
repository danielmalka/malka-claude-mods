import type { CleanColors, CleanTheme } from '../types'
import { colorsFor, THEMES } from './clean'

// The settings page, shared by the own pane and the menu's pane.
export function cleanPage(
  { Box, Text, Button, Input }: { Box: any; Text: any; Button: any; Input: any },
  p: {
    isOn: boolean
    theme: CleanTheme
    custom: CleanColors
    hasBack: boolean
    onOn: (v: boolean) => unknown
    onTheme: (t: CleanTheme) => unknown
    onColor: (part: keyof CleanColors, value: string) => unknown
    onBack: () => unknown
  },
) {
  const option = (key: string, label: string, isOn: boolean, onPress: () => unknown, swatch?: string) => (
    <Box key={`row-${key}`} gap={1}>
      {swatch !== undefined && <Text color={swatch}>■</Text>}
      <Button key={key} plain label={`${isOn ? '●' : '○'} ${label}`} dimColor={!isOn} onPress={onPress} />
    </Box>
  )
  const heading = (text: string) => (
    <Box key={`h-${text}`} marginTop={1}>
      <Text bold>{text}</Text>
    </Box>
  )
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="claude">
          ◆ Clean screen
        </Text>
        {p.hasBack && <Button key="mods-back" plain dimColor hotkey="b" label="← back" onPress={p.onBack} />}
      </Box>
      <Text dimColor>Hides tool calls and their output. Shows Claude's text and a progress band above the prompt.</Text>
      {heading('Clean screen')}
      {option('cs-on', 'On', p.isOn, () => p.onOn(true))}
      {option('cs-off', 'Off', !p.isOn, () => p.onOn(false))}
      {heading('Band color')}
      {THEMES.map(t => option(`cs-theme-${t}`, t, t === p.theme, () => p.onTheme(t), colorsFor(t, p.custom).bar))}
      {p.theme === 'custom' && (
        <Box flexDirection="column">
          {(['bar', 'text', 'border'] as const).map(part => (
            <Input
              key={`cs-color-${part}`}
              label={`${part} color`}
              value={p.custom[part]}
              placeholder="#3b82f6"
              submitLabel="set"
              onSubmit={(value: string) => p.onColor(part, value)}
            />
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>↑↓ move · enter select · esc close</Text>
      </Box>
    </Box>
  )
}
