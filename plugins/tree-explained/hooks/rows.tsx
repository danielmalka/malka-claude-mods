import type { Row } from './tree'
import { rowKey } from './tree'

type Ui = { Box: any; Text: any; Button: any }

export const EDIT = '#ff9e3b'
const EDIT_GLOW = '#ffd08a'
const READ = '#a78bfa'
const ADD = '#4ade80'
const DEL = '#f87171'

const sums = ({ Text }: Ui, add: number, del: number) => [
  ...(add > 0 ? [<Text key="add" color={ADD}> +{add}</Text>] : []),
  ...(del > 0 ? [<Text key="del" color={DEL}> -{del}</Text>] : []),
]

// One visible row: a folder is a Button (press toggles it), a file a keyed Box (the scroll target).
export function rowView(ui: Ui, r: Row, p: { inflight: string[]; shimmer: boolean; onToggle: (key: string) => unknown }) {
  const { Box, Text, Button } = ui
  const e = r.entry
  if (e === undefined) {
    const caret = r.isOpen ? '▾ ' : '▸ '
    return (
      <Button key={`dir:${r.key}`} plain onPress={() => p.onToggle(r.key)}>
        <Text dimColor>{r.prefix}</Text>
        <Text bold>{caret}{r.name}</Text>
        {!r.isOpen && r.suffix !== '' && <Text dimColor> {r.suffix}</Text>}
        {!r.isOpen && sums(ui, r.add, r.del)}
      </Button>
    )
  }
  const live = p.inflight.includes(e.path)
  const base = e.kind === 'edit' ? EDIT : READ
  return (
    <Box key={rowKey(e.path)}>
      <Text wrap="truncate">
        <Text dimColor>{r.prefix}</Text>
        <Text color={live && p.shimmer ? EDIT_GLOW : base} bold={live} dimColor={e.kind === 'read' && !live}>
          {r.name}
        </Text>
        {sums(ui, e.add, e.del)}
      </Text>
    </Box>
  )
}
