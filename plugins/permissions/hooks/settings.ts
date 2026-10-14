// ~/.claude/settings.json edits on a parsed object: other keys are kept; an invalid file throws before anything is written.
export type Settings = Record<string, any>

// An error whose message is fixed text of this mod: safe to show. Anything else is shown as a generic line (see `why`).
export class SettingsError extends Error {}

export const why = (error: unknown): string =>
  error instanceof SettingsError ? error.message : 'the settings file could not be read or written; nothing was changed.'

export function parseSettings(text: string, name = 'settings.json'): Settings {
  let s: unknown
  try {
    s = JSON.parse(text)
  } catch {
    throw new SettingsError(`${name} is not valid JSON; nothing was written.`)
  }
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new SettingsError(`${name} is not a JSON object; nothing was written.`)
  return s as Settings
}

const ABSOLUTE = /^(\/|[A-Za-z]:[\\/]|\\\\)/

// CLAUDE_CONFIG_DIR when it is an absolute path, else <home>/.claude; never a relative path.
export function configDir(configDirEnv: string | undefined, home: string | undefined): string {
  const dir = configDirEnv && ABSOLUTE.test(configDirEnv) ? configDirEnv : home ? `${home}/.claude` : ''
  if (!ABSOLUTE.test(dir)) throw new SettingsError('no absolute CLAUDE_CONFIG_DIR, HOME or USERPROFILE: settings.json not touched')
  return dir.replaceAll('\\', '/').replace(/\/+$/, '')
}

export const currentDefault = (s: Settings): string | undefined =>
  typeof s.permissions?.defaultMode === 'string' ? s.permissions.defaultMode : undefined

// Only permissions.defaultMode changes; a non-object `permissions` is refused rather than overwritten.
export function withDefaultMode(s: Settings, mode: string): Settings {
  const p = s.permissions
  if (p !== undefined && (p === null || typeof p !== 'object' || Array.isArray(p))) throw new SettingsError('settings.json "permissions" is not an object; nothing was written.')
  return { ...s, permissions: { ...p, defaultMode: mode } }
}
