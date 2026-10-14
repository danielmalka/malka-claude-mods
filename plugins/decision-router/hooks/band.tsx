import type { Decision } from './decide'

export type Offer = { model: boolean; effort: boolean; effortHeld: boolean; modelCurrent?: boolean }

const pct = (c: number) => `${Math.round(c * 100)}%`

// The band's lines: every value shows its confidence (R13); a value under the threshold is "kept" with that confidence (R14).
export function bandLines(d: Decision, o: Offer, min: number): string[] {
  const kept = (what: string, name: string, c: number) => `${what} kept: ${name} suggested at ${pct(c)}, below ${pct(min)}`
  return [
    o.modelCurrent
      ? `Model: ${d.model} (current) · confidence ${pct(d.modelConfidence)}`
      : o.model
        ? `Suggested model: ${d.model} · confidence ${pct(d.modelConfidence)}`
        : kept('Model', d.model, d.modelConfidence),
    o.effort
      ? `Suggested effort: ${d.effort} · confidence ${pct(d.effortConfidence)}`
      : o.effortHeld
        ? `Effort kept: you already chose one in /mode (${d.effort} at ${pct(d.effortConfidence)})`
        : kept('Effort', d.effort, d.effortConfidence),
  ]
}

// R17 auto: one toast, no band, naming what was applied or kept with the confidences.
export function autoLine(d: Decision, o: Offer, min: number): string {
  const part = (what: string, name: string, c: number, applied: boolean) =>
    applied ? `${what} ${name} applied (${pct(c)})` : `${what} kept (${name} suggested at ${pct(c)}, below ${pct(min)})`
  return `Decision router, subagent: ${part('model', d.model, d.modelConfidence, o.model)}; ${part('effort', d.effort, d.effortConfidence, o.effort)}`
}

type Ui = { Box: any; Text: any; Button: any }
export function band({ Box, Text, Button }: Ui, lines: string[], canSwitch: boolean, answer: ((v: 'switch' | 'keep') => void) | null, id = '', title = '◆ Decision router') {
  return (
    <Box key={`decision-router-band${id}`} flexDirection="column" paddingX={1}>
      <Text bold color="claude">
        {title}
      </Text>
      {lines.map(l => (
        <Text key={l}>{l}</Text>
      ))}
      {answer !== null && (
        <Box gap={2}>
          {canSwitch && <Button key={`switch${id}`} label="Switch" onPress={() => answer('switch')} />}
          <Button key={`keep${id}`} label="Keep" onPress={() => answer('keep')} />
        </Box>
      )}
    </Box>
  )
}
