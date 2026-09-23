// A turn's two edges, as a harness reports them: the words a person typed, and
// the reply the turn ended on. The harness runs this file as a hook command on
// every prompt and every stop, so it has a budget of milliseconds: it imports
// nothing, opens no graph, and appends one line to a spool file. The
// `@yaks/session/service` duty reads the spool into transcript entries, in the
// order the lines were written (./service.ts).
//
// A spool rather than a graph write, because a command that opens the graph
// takes about a second and writes its own process row. A second on every
// prompt is a second the person waits, and two process rows a turn are noise.
//
// Every touch of the spool holds an advisory exclusive lock on the file:
// appending, and the drain's read and its trim. So a line is never torn, and an
// append never lands in bytes a drain has already read and is about to trim.
// The drain trims only after its entries are written, so a crash in between
// repeats lines rather than losing them; the service writes each line under an
// id derived from the line, which makes a repeat a no-op.

/** One line of the spool: a transcript's input or output, as the harness
 * reported it. */
export type Turn = {
  /** the harness's own id for the session */
  sid: string
  /** when the hook ran */
  at: string
  /** what a person typed */
  input?: string
  /** the reply the turn ended on */
  output?: string
}

let str = (v: unknown): string => typeof v == 'string' ? v : ''

/**
 * Where the spool for a graph's database lives: beside it. A graph held in
 * memory has nowhere for a hook to write, so it has no spool.
 *
 * ```ts
 * spoolOf('/home/me/.yak/yak.db') // '/home/me/.yak/spool/turns.jsonl'
 * ```
 */
export let spoolOf = (db?: string): string | undefined =>
  db && db != ':memory:'
    ? `${db.slice(0, db.lastIndexOf('/') + 1)}spool/turns.jsonl`
    : undefined

/**
 * The spool line a hook payload makes: a prompt is an input, a stop is an
 * output, and anything else is no line at all.
 *
 * ```ts
 * turnOf({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hi' }, 'T')
 * // { sid: 's', at: 'T', input: 'hi' }
 * ```
 */
export let turnOf = (
  body: Record<string, unknown>,
  at: string = new Date().toISOString(),
): Turn | undefined => {
  let sid = str(body.session_id)
  let event = body.hook_event_name
  let input = event == 'UserPromptSubmit' ? str(body.prompt) : ''
  let output = event == 'Stop' ? str(body.last_assistant_message) : ''
  if (!sid || !(input || output)) return undefined
  return { sid, at, ...(input ? { input } : { output }) }
}

let locked = <T>(f: Deno.FsFile, body: () => T): T => {
  f.lockSync(true)
  try {
    return body()
  } finally {
    f.unlockSync()
  }
}

// A file write may take fewer bytes than it was handed; this one keeps going.
let writeAll = (f: Deno.FsFile, bytes: Uint8Array) => {
  for (let at = 0; at < bytes.length;) at += f.writeSync(bytes.subarray(at))
}

let readAll = (f: Deno.FsFile): Uint8Array => {
  let chunks: Uint8Array[] = []
  let buf = new Uint8Array(65536)
  for (let n; (n = f.readSync(buf)) != null;) chunks.push(buf.slice(0, n))
  let out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
  let at = 0
  for (let c of chunks) out.set(c, at), at += c.length
  return out
}

/** Append a hook payload's line to the spool, creating the file and its
 * directory where they are missing. */
export let report = (body: Record<string, unknown>, path: string): void => {
  let turn = turnOf(body)
  if (!turn) return
  let slash = path.lastIndexOf('/')
  if (slash > 0) Deno.mkdirSync(path.slice(0, slash), { recursive: true })
  let f = Deno.openSync(path, { append: true, create: true, write: true })
  try {
    let line = new TextEncoder().encode(`${JSON.stringify(turn)}\n`)
    locked(f, () => writeAll(f, line))
  } finally {
    f.close()
  }
}

/** The complete lines in the spool, and how many bytes they took — what
 * {@link trim} is handed once they are written down. The file is left as it
 * was. */
export let taken = (path: string): { turns: Turn[]; bytes: number } => {
  let f: Deno.FsFile
  try {
    f = Deno.openSync(path, { read: true })
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return { turns: [], bytes: 0 }
    throw e
  }
  try {
    // Up to the last newline: a fragment after it is not a line yet.
    let all = locked(f, () => readAll(f))
    let bytes = all.lastIndexOf(10) + 1
    let turns = new TextDecoder().decode(all.subarray(0, bytes)).split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Turn]
        } catch {
          return [] // a line that is not JSON is nobody's turn
        }
      })
    return { turns, bytes }
  } finally {
    f.close()
  }
}

/** Drop the first `bytes` of the spool, keeping whatever was appended since
 * they were read. */
export let trim = (path: string, bytes: number): void => {
  if (!bytes) return
  let f = Deno.openSync(path, { read: true, write: true })
  try {
    locked(f, () => {
      let rest = readAll(f).slice(bytes)
      f.truncateSync(0)
      f.seekSync(0, Deno.SeekMode.Start)
      writeAll(f, rest)
    })
  } finally {
    f.close()
  }
}

// The hook itself: the payload on stdin, the spool named on the command line.
// A hook that fails is a prompt that will not send, so nothing here throws.
if (import.meta.main) {
  try {
    let text = await new Response(Deno.stdin.readable).text()
    if (Deno.args[0]) report(JSON.parse(text), Deno.args[0])
  } catch { /* the turn goes unrecorded; the session goes on */ }
}
