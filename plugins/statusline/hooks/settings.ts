// ~/.claude/settings.json edits on a parsed object: other keys are kept; an invalid file throws before anything is written.
export type Settings = Record<string, any>

export function parseSettings(text: string): Settings {
  const s = JSON.parse(text)
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('settings.json is not a JSON object')
  return s
}

const ABSOLUTE = /^(\/|[A-Za-z]:[\\/]|\\\\)/

// CLAUDE_CONFIG_DIR when it is an absolute path, else <home>/.claude; never a relative path.
export function configDir(configDirEnv: string | undefined, home: string | undefined): string {
  const dir = configDirEnv && ABSOLUTE.test(configDirEnv) ? configDirEnv : home ? `${home}/.claude` : ''
  if (!ABSOLUTE.test(dir)) throw new Error('no absolute CLAUDE_CONFIG_DIR, HOME or USERPROFILE: settings.json not touched')
  return dir.replaceAll('\\', '/').replace(/\/+$/, '')
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// The user's latest explicit statusLine wins; a saved value it supersedes is returned as `prev` so the caller keeps it.
// On: a live statusLine leaves the file and is saved. Off: a live one stays and the stale saved one is dropped;
// else the saved one comes back. `drop` = delete the saved value afterwards. undefined when nothing changes.
export function moveStatusLine(s: Settings, isOn: boolean, saved: { statusLine: unknown } | undefined) {
  const live = s.statusLine
  const prev = saved !== undefined && live !== undefined && !same(saved.statusLine, live) ? saved.statusLine : undefined
  if (isOn) {
    if (live === undefined) return undefined
    const { statusLine, ...next } = s
    return { next, save: { statusLine }, prev, drop: false }
  }
  if (saved === undefined) return undefined
  if (live !== undefined) return { next: s, save: undefined, prev, drop: true }
  return { next: { ...s, statusLine: saved.statusLine }, save: undefined, prev: undefined, drop: true }
}
