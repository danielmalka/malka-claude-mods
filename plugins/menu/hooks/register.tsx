import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {} from '../types/statusline'
import type {} from '../types/cleanscreen'
import type {} from '../types/mode'

const panelAtom = atom({ plugin: 'menu', key: 'panel' } as const, 'main')
const presentAtom = atom({ plugin: 'menu', key: 'present' } as const, false)

// Members known statically (state refs must be source literals). Each publishes `menuEntry` (apiVersion 1).
const statuslineEntry = { plugin: 'statusline', key: 'menuEntry' } as const
const cleanscreenEntry = { plugin: 'cleanscreen', key: 'menuEntry' } as const
const modeEntry = { plugin: 'mode', key: 'menuEntry' } as const

const PANE = 'mods-menu'
const NAMES = ['statusline', 'cleanscreen', 'mode']

type Row = { name: string; title: string; summary: string; order: number }

// The installed members' entries: missing, malformed or another apiVersion are skipped; sorted by `order`.
async function entries($: EngineInterface): Promise<Row[]> {
  const none = () => ({ value: undefined })
  const found = [
    (await $.state.get(statuslineEntry).catch(none)).value,
    (await $.state.get(cleanscreenEntry).catch(none)).value,
    (await $.state.get(modeEntry).catch(none)).value,
  ]
  const rows: Row[] = []
  found.forEach((v, i) => {
    if (v && v.apiVersion === 1 && typeof v.title === 'string') rows.push({ name: NAMES[i]!, title: v.title, summary: String(v.summary), order: Number(v.order) || 0 })
  })
  return rows.sort((a, b) => a.order - b.order)
}

// The engine's hint on one row: it can carry a second line holding only a separator, which drew as a stray dot.
const hintText = (hint: string) =>
  hint
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /[\p{L}\p{N}]/u.test(line))
    .join(' · ')

let isOpen = false

async function toggle($: EngineInterface, panel = 'main') {
  if (isOpen) {
    isOpen = false
    await $.ui.close({ id: PANE })
    return
  }
  await update($, panelAtom, () => panel)
  isOpen = true
  await $.ui.open({ id: PANE, title: 'mods', focus: true, closeOnEscape: true, rows: 16, columns: 56 })
}

const goTo = ($: EngineInterface, panel: string) => update($, panelAtom, () => panel)

// A member page only when its entry is present now; otherwise main, with a toast.
async function goToMember($: EngineInterface, name: string) {
  if ((await entries($)).some(r => r.name === name)) return goTo($, name)
  $.ui.toast(`${name} is not installed`)
  return goTo($, 'main')
}

async function back($: EngineInterface, e: any, next: any) {
  await goTo($, 'main')
  return next(e)
}

function mainPage({ Box, Text, Button }: { Box: any; Text: any; Button: any }, rows: Row[], onOpen: (name: string) => unknown) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="claude">
        ◆ mods
      </Text>
      {rows.length === 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text>No mods installed</Text>
          <Text dimColor>Install one with /plugin install statusline@malka-claude-mods</Text>
          <Text dimColor>(also cleanscreen or mode).</Text>
        </Box>
      )}
      {rows.map((r, i) => (
        <Box key={`row-${r.name}`} flexDirection="column" marginTop={1}>
          <Button
            key={`open-${r.name}`}
            plain
            hotkey={String(i + 1)}
            autoFocus={i === 0 ? true : undefined}
            label={`${r.title}  ›`}
            onPress={() => onOpen(r.name)}
          />
          <Text dimColor>   {r.summary}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>↑↓ move · enter select · esc close</Text>
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, presentAtom, () => true)
    await update($, panelAtom, () => 'main')
    isOpen = false
    await $.command
      .register({ name: 'mods', description: 'Open the mods menu', argumentHint: '[statusline|cleanscreen|mode]', immediate: true })
      .catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'mods' }, async ($, e) => {
    try {
      const arg = e.args.trim().toLowerCase()
      const known = NAMES.includes(arg)
      const panel = known && (await entries($)).some(r => r.name === arg) ? arg : 'main'
      if (known && panel === 'main') $.ui.toast(`${arg} is not installed`)
      if (isOpen) await goTo($, panel)
      else await toggle($, panel)
      return { text: 'The mods menu is open.' }
    } catch (error) {
      return { text: `The mods menu could not open: ${String(error)}` }
    }
  })

  // Main page only: a member draws its own page when the panel is its name (the hooks beneath).
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const rows = await entries($)
    const panel = await read($, panelAtom)
    // a member page whose entry is gone falls back to main
    if (panel !== 'main' && rows.some(r => r.name === panel)) return next(e)
    return mainPage($.ui.resolve(e), rows, name => goToMember($, name))
  })

  // However the pane closes (esc, its mark, the footer button), the menu resets.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    isOpen = false
    await update($, panelAtom, () => 'main').catch(() => undefined)
    return next(e)
  }).catch(() => undefined)

  on('ui.press', { plugin: 'statusline', element: 'mods-back' }, back)
  on('ui.press', { plugin: 'cleanscreen', element: 'mods-back' }, back)
  on('ui.press', { plugin: 'mode', element: 'mods-back' }, back)

  on('ui.press', { plugin: 'statusline', element: 'mods-open' }, async ($, e, next) => {
    await toggle($)
    return next(e)
  })

  // Footer, disjoint with the status line: when it is on, it draws the row and the ◆ mods button itself.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const { value } = await $.state.get(statuslineEntry).catch(() => ({ value: undefined }))
    if (value?.summary === 'on') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box justifyContent="space-between" flexGrow={1} gap={1}>
        <Text dimColor wrap="truncate">
          {hintText(e.props.hint)}
        </Text>
        <Button key="mods-open" plain label="◆ mods" onPress={() => toggle($)} />
      </Box>
    )
  })
}
