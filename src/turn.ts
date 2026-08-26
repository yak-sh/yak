// The lifecycle hook's hot path: turn payload into the server's durable spool.
// It deliberately imports nothing and waits on no server response — a busy
// event loop cannot consume Claude's three-second hook budget.
//
// Concurrency (T-21949): many hook processes append while the server drains.
// The old shape (bare O_APPEND writes + a rename-based take) could lose a
// line: an appender that opened the spool just before drain renamed it wrote
// into the taken file after drain had read it, and the remove threw the line
// away. An advisory exclusive lock on the spool inode serializes every touch
// — append, requeue, and drain's read+truncate — so lines neither tear nor
// land in a file that has already been read. Drain holds the lock only for
// the read+truncate and processes from memory afterwards, so appenders wait
// microseconds, never on the server's work.

export let turnOf = (body: Record<string, unknown>) =>
  body.hook_event_name == 'UserPromptSubmit'
    ? 'busy'
    : body.hook_event_name == 'Stop'
    ? 'idle'
    : undefined

let locked = <T>(f: Deno.FsFile, body: () => T): T => {
  f.lockSync(true)
  try {
    return body()
  } finally {
    f.unlockSync()
  }
}

// One locked single-write append; shared by report and drain's requeue so
// every writer honors the same lock and a line is one write() call.
let append = (path: string, lines: string) => {
  let f = Deno.openSync(path, { append: true, create: true, write: true })
  try {
    locked(f, () => f.writeSync(new TextEncoder().encode(lines)))
  } finally {
    f.close()
  }
}

let readAll = (f: Deno.FsFile) => {
  let chunks: Uint8Array[] = []
  let buf = new Uint8Array(65536)
  for (let n; (n = f.readSync(buf)) != null;) chunks.push(buf.slice(0, n))
  let out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
  let at = 0
  for (let c of chunks) out.set(c, at), at += c.length
  return new TextDecoder().decode(out)
}

export let report = (
  body: Record<string, unknown>,
  path = `${Deno.env.get('HOME')}/.tasks/turns.jsonl`,
) => {
  let sid = String(body.session_id ?? '')
  let turn = turnOf(body)
  if (!sid || !turn) return
  append(path, `${JSON.stringify({ sid, turn })}\n`)
}

export let drain = (
  act: (turn: { sid: string; turn: string }) => void,
  path = `${Deno.env.get('HOME')}/.tasks/turns.jsonl`,
) => {
  let f: Deno.FsFile
  try {
    f = Deno.openSync(path, { read: true, write: true })
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return
    throw e
  }
  let lines: string[]
  try {
    lines = locked(f, () => {
      let text = readAll(f)
      // Truncate only what was read: the server's fs watcher re-drains on any
      // turns.jsonl event, and truncating an already-empty spool emits one —
      // an unconditional truncate here fed that event back into itself and
      // span the watcher at ~7k drains/s, pegging the event loop.
      if (text) f.truncateSync()
      return text.split('\n').filter(Boolean)
    })
  } finally {
    f.close()
  }
  for (let i = 0; i < lines.length; i++) {
    try {
      act(JSON.parse(lines[i]))
    } catch (e) {
      append(path, `${lines.slice(i).join('\n')}\n`)
      throw e
    }
  }
}

if (import.meta.main) {
  try {
    let text = await new Response(Deno.stdin.readable).text()
    report(JSON.parse(text))
  } catch { /* a hook must never wedge its session */ }
}
