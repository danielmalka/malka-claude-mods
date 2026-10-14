import type { Effort } from '../types'
import { EFFORTS, MODELS, modelFamily } from './modes'

type Ui = { Box: any; Text: any; Button: any }

// The Mode page: model and effort, one item per row so the arrow keys walk it top to bottom.
export function modePage(
  { Box, Text, Button }: Ui,
  p: {
    hasBack: boolean
    model: string | null
    level: Effort | null // the level shown as chosen: the user's, else the session's
    onModel: (alias: string) => unknown
    onEffort: (level: Effort | 'default') => unknown
    onBack: () => unknown
  },
) {
  const option = (key: string, label: string, isOn: boolean, onPress: () => unknown) => (
    <Box key={`row-${key}`} gap={1}>
      <Button key={key} plain label={`${isOn ? '●' : '○'} ${label}`} dimColor={!isOn} onPress={onPress} />
    </Box>
  )
  const heading = (text: string) => (
    <Box key={`h-${text}`} marginTop={1}>
      <Text bold>{text}</Text>
    </Box>
  )
  const family = modelFamily(p.model)
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="claude">
          ◆ Mode
        </Text>
        {p.hasBack && <Button key="mods-back" plain dimColor hotkey="b" label="← back" onPress={p.onBack} />}
      </Box>
      <Text dimColor>Pick the model and the reasoning effort.</Text>
      {heading('Model')}
      {MODELS.map(m => option(`model-${m.alias}`, m.label, m.alias === family, () => p.onModel(m.alias)))}
      <Button key="model-default" plain dimColor label="↺ Claude Code's default" onPress={() => p.onModel('default')} />
      {heading('Effort')}
      {EFFORTS.map(l => option(`effort-${l}`, l, l === p.level, () => p.onEffort(l)))}
      <Button key="effort-default" plain dimColor label="↺ default" onPress={() => p.onEffort('default')} />
      <Box marginTop={1}>
        <Text dimColor>↑↓ move · enter select · esc close</Text>
      </Box>
    </Box>
  )
}
