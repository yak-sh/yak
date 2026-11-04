import * as disk from '@yaks/file/io'
// A worker serves an existing file, never an unlinked SQLite connection. A
// fallback also belongs to the web that requested it; managed workers do not.

/** Capture the file identity before opening SQLite, so a removed graph cannot
 * be silently recreated, and a replacement at the same path is a new graph. */
export let lifetime = async (path: string, starter?: number) => {
  let original = path == ':memory:' ? undefined : await disk.stat(path)
  let owner = starter
    ? await disk.readTextFile(`/proc/${starter}/stat`)
    : undefined
  let identity = (stat: string) =>
    stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
  return async (): Promise<boolean> => {
    try {
      if (original) {
        let current = await disk.stat(path)
        if (current.dev != original.dev || current.ino != original.ino) {
          return false
        }
      }
      if (starter && owner) {
        let current = await disk.readTextFile(`/proc/${starter}/stat`)
        let state = current.slice(current.lastIndexOf(')') + 2).split(' ')[0]
        if (state == 'Z' || identity(current) != identity(owner)) return false
      }
      return true
    } catch (error) {
      if (error instanceof disk.errors.NotFound) return false
      throw error
    }
  }
}
