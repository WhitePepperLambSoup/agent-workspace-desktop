const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Turns a session title into a safe default archive file name. */
export function sessionArchiveFileName(title: unknown): string {
  const raw = typeof title === 'string' ? title : ''
  let base = raw
    // Characters Windows forbids in file names, plus control characters.
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim()
  if (!base || RESERVED_WINDOWS_NAMES.test(base)) base = 'session'
  return `${base}.zip`
}
