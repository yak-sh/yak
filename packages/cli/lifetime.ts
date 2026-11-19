import * as disk from '@yaks/file/io'
// A worker serves an existing file, never an unlinked SQLite connection. A
// fallback also belongs to the web that requested it; managed workers do not.

/** Capture the file identity before opening SQLite, so a removed graph cannot
 * be silently recreated, and a replacement at the same path is a new graph.
 * A `tether` is a stream its starter holds open and never writes: its end,
 * however the starter ended, ends the worker's reason to serve. A worker's
 * `ready` file ({@link superseded}) ends it once a newer one of its role is
 * ready. */
export let lifetime = async (
  path: string,
  tether?: ReadableStream<Uint8Array>,
  ready?: string,
) => {
  let replaced = ready ? superseded(ready) : () => Promise.resolve(false)
  let original = path == ':memory:' ? undefined : await disk.stat(path)
  let cut = false
  let end = () => void (cut = true)
  tether?.pipeTo(new WritableStream()).then(end, end)
  return async (): Promise<boolean> => {
    if (cut || await replaced()) return false
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

// `<dir>/<role>-<instance uuid>.ready` (./restart.ts `readyFile`).
let INSTANCE = /^(.+)-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.ready$/

/**
 * Whether an instance of the same role became ready after this one: its
 * replacement, which it leaves to. The handover's own process stops the old
 * instances once its replacements are ready, but a handover that dies between
 * the two (killed with the box out of memory, T-1463) left two of every role
 * running, each starting agents. So the old one leaves on its own.
 */
export let superseded = (ready: string): () => Promise<boolean> => {
  let at = ready.lastIndexOf('/')
  let dir = ready.slice(0, at)
  let role = INSTANCE.exec(ready.slice(at + 1))?.[1]
  let mtime = (path: string) =>
    disk.stat(path).then((s) => s.mtime?.getTime(), () => undefined)
  return async () => {
    let mine = role && await mtime(ready)
    if (!mine) return false
    for await (let file of disk.readDir(dir)) {
      if (INSTANCE.exec(file.name)?.[1] != role) continue
      let theirs = await mtime(`${dir}/${file.name}`)
      if (theirs && theirs > mine) return true
    }
    return false
  }
}
