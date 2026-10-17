import { mock } from 'claude-code/testing'

export const ok = { value: undefined } as any
export const pane = { plugin: 'tree-explained', surface: 'terminal', component: 'Pane', requestId: 'tree-explained', props: { bodyColumns: 50, placement: 'dock', scroll: { bodyRows: 20 }, view: {} } } as any

export const NOW = 100_000
export const FRESH = NOW + 500 // written after the baseline
export const clock = { c: undefined as any } // the clock of the running test: a Bash sweep runs on its first tick
export const setClock = (c: any) => (clock.c = c)
export type W = { calls: string[][]; status: string; numstat: string; patch: string; isRepo: boolean; fail: boolean; files: Map<string, { mtime: number; text?: string; kind?: string; link?: boolean; linkOnResolve?: boolean }>; reads: string[]; real: Map<string, string>; top: string; truncate: boolean; version: string; filters: string; statusExit: number; gateConfig?: Promise<void>; statGate?: Promise<void>; statHit: boolean; gateDiff?: Promise<void>; configExit?: number; configFailDir?: string; patchTruncate: boolean; configTruncate: boolean; configReject: boolean; numstatMode?: 'reject' | 'truncate' | '128'; cwdNow?: string; envs: any[]; statPaths: string[]; gate?: Promise<void>; toasts: string[]; requests: any[]; store: Record<string, unknown> }

// the engine beneath the plugin plus a fake git and file system
export function world(on: any, o: { isOn?: boolean; bash?: (e: any) => any } = {}): W {
  const w: W = { calls: [], status: '', numstat: '', patch: '', isRepo: true, fail: false, files: new Map(), reads: [], real: new Map(), top: '/work/proj', truncate: false, version: 'git version 2.53.0\n', filters: '', statusExit: 0, statHit: false, envs: [], statPaths: [], configTruncate: false, patchTruncate: false, configReject: false, toasts: [], requests: [], store: o.isOn ? { isOn: true } : {} }
  on('store.get', (_$: any, e: any) => ({ value: w.store[e.key] }))
  on('store.set', (_$: any, e: any) => ((w.store[e.key] = e.value), ok))
  on('store.delete', (_$: any, e: any) => (delete w.store[e.key], ok))
  on('state.get', (_$: any, e: any, next: any) => (e.plugin === 'menu' ? { value: { value: undefined, version: 0 } } : next(e)))
  on('command.register', () => ok)
  on('session.cwd', (_$: any, e: any, next: any) => (w.cwdNow ? { value: w.cwdNow } : next(e)))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ok)
  on('ui.toast', (_$: any, e: any) => (w.toasts.push(e.text), ok))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  on('ui.render', async ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('tool.call', (_$: any, e: any) => (e.tool === 'Bash' && o.bash ? o.bash(e) : { result: 'ok' }))
  on('model.complete', (_$: any, e: any) => (w.requests.push(e), { value: { isAnswered: true, text: 'Headline\n- did a thing', usage: {} } }))
  on('fs.stat', async (_$: any, e: any) => {
    w.statPaths.push(e.path)
    const f = w.files.get(e.path)
    const realPath = e.resolve ? (w.real.get(e.path) ?? (w.files.has(e.path) ? e.path : undefined)) : undefined
    if (e.resolve && e.path === '/work/proj' && w.statGate) {
      w.statHit = true
      await w.statGate
    }
    if (!f) {
      if (realPath !== undefined) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: true, realPath } }
      throw new Error('ENOENT')
    }
    const swapped = e.resolve && f.linkOnResolve
    return { value: { kind: f.kind ?? 'file', size: f.text?.length ?? 10, mtimeMs: f.mtime, isLink: swapped ? true : (f.link ?? false), realPath } }
  })
  on('fs.read', (_$: any, e: any) => (w.reads.push(e.path), { value: w.files.get(e.path)?.text ?? '' }))
  on('process.run', async (_$: any, e: any) => {
    w.calls.push([...e.argv])
    w.envs.push(e.init?.env)
    const args: string[] = e.argv.slice(e.argv.indexOf('-C') + 2)
    if (args[0] === '--version') return { value: { exitCode: 0, stdout: w.version, stderr: '' } }
    if (args[0] === 'config') await w.gateConfig
    if (w.fail || (args[0] === 'config' && w.configReject)) throw new Error('timed out')
    if (args[0] === 'config' && e.argv[e.argv.indexOf('-C') + 1] === w.configFailDir) return { value: { exitCode: 2, stdout: '', stderr: '' } }
    if (args[0] === 'config') return { value: { exitCode: w.configExit ?? (w.filters === '' ? 1 : 0), stdout: w.filters, stderr: '', isStdoutTruncated: w.configTruncate } }
    if (args.includes('--numstat') && w.numstatMode === 'reject') throw new Error('timed out')
    if (args.includes('--numstat') && w.numstatMode === '128') return { value: { exitCode: 128, stdout: '', stderr: 'bad revision HEAD' } }
    if (args.includes('--numstat') && w.numstatMode === 'truncate') return { value: { exitCode: 0, stdout: w.numstat.slice(0, 3), stderr: '', isStdoutTruncated: true } }
    if (args.includes('--unified=1')) await w.gateDiff
    if (args[0] === 'rev-parse') return { value: { exitCode: w.isRepo ? 0 : 128, stdout: w.isRepo ? `${e.argv[e.argv.indexOf('-C') + 1] === '/work/proj' ? w.top : e.argv[e.argv.indexOf('-C') + 1]}\n` : '', stderr: '' } }
    if (args[0] === 'status') {
      await w.gate
      return { value: { exitCode: w.statusExit, stdout: w.status, stderr: '', isStdoutTruncated: w.truncate } }
    }
    if (args.includes('--unified=1') && w.patchTruncate) return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: true } }
    return { value: { exitCode: 0, stdout: args.includes('--numstat') ? w.numstat : w.patch, stderr: '' } }
  })
  return w
}

export const start = ($: any) => $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
export const call = ($: any, extra: any = {}) => $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'python3 - <<EOF\nSECRET_CMD_TEXT\nEOF', ...extra })
export const tick = async () => (await clock.c.advance(0), await clock.c.advance(0))
// real macrotasks: lets the hooks and the stubs run while a test waits
export const until = async (cond: () => boolean, max = 100) => {
  for (let i = 0; i < max && !cond(); i++) await new Promise(r => setTimeout(r, 0))
}
export const bash = async ($: any, extra: any = {}) => {
  const r = await call($, extra)
  await tick()
  return r
}
export const finish = ($: any) => $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
export const gits = (w: W, sub: string) => w.calls.filter(c => c.includes(sub))
export const changeA = (w: W, mtime = FRESH) => {
  w.files.set('/work/proj/src/a.ts', { mtime })
  w.status = ' M src/a.ts\0'
  w.numstat = '3\t1\tsrc/a.ts\0'
  w.patch = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,3 @@\n-a\n+b\n+c\n'
}
export const shown = async (ui: any, re: RegExp) => (await ui.find({ type: 'Text', text: re })) !== undefined

