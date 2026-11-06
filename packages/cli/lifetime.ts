import * as disk from '@yaks/file/io'
// A worker serves an existing file, never an unlinked SQLite connection. A
// fallback also belongs to the web that requested it; managed workers do not.

/** Capture the file identity before opening SQLite, so a removed graph cannot
 * be silently recreated, and a replacement at the same path is a new graph.
 * A `tether` is a stream its starter holds open and never writes: its end,
 * however the starter ended, ends the worker's reason to serve. */
export let lifetime = async (
  path: string,
  tether?: ReadableStream<Uint8Array>,
) => {
  let original = path == ':memory:' ? undefined : await disk.stat(path)
  let cut = false
  let end = () => void (cut = true)
  tether?.pipeTo(new WritableStream()).then(end, end)
  return async (): Promise<boolean> => {
    if (cut) return false
    try {
      if (original) {
        let current = await disk.stat(path)
        if (current.dev != original.dev || current.ino != original.ino) {
          return false
        }
      }
      return true
    } catch (error) {
      if (error instanceof disk.errors.NotFound) return false
      throw error
    }
  }
}
