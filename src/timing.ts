// The `--timing` line: one line on stderr for every HTTP response a CLI
// receives, carrying that answer's own `Server-Timing` verbatim.
//
//   GET /query?.status=wip 200  hops;dur=6, rows;dur=3, total;dur=4
//
// Both servers already say where a request's time went — the tasks server on
// /query and /apply (server_runtime.ts `tallied`), the yaks.app worker on
// every door (workers/yak/timing.ts) — and a browser draws that header in its
// network panel for free. A shell has no panel, so this is it. Nothing is
// computed here and nothing is reworded: the numbers printed are the bytes the
// server sent, so a line here and a `curl -i` agree.
//
// Off unless asked. Each CLI arms it once, before it parses a verb, from its
// own flag and its own env var (`task --timing` / TASKS_TIMING, `yak --timing`
// / YAKS_TIMING), so the flag holds for every verb rather than for the ones
// that remembered to declare it.

// The switch and the sink, as one settable thing: a test reads the lines
// without owning the process's stderr.
export let timing = {
  on: false,
  say: (line: string) => console.error(line),
}

/** Arm the line: the flag as typed, or the env var set for a whole shell. */
export let watching = (flag: boolean, env?: string) =>
  timing.on = flag || env == '1' || env == 'true'

// The request-target as HTTP spells it — path and query, no origin. A caller
// that hands over something that is not a URL gets it back as it came.
let target = (url: string | URL) => {
  try {
    let u = new URL(url)
    return u.pathname + u.search
  } catch {
    return String(url)
  }
}

// As little of a Response as the line reads, so a test's stand-in is two
// fields rather than a whole web object.
type Answer = {
  status: number
  headers: { get: (name: string) => string | null }
}

/** An answer said in one line: what was asked, what came back, and the
 * server's own timing after two spaces, so the numbers land in a column. A
 * door that sends no `Server-Timing` still gets a line — that it says nothing
 * is worth knowing too. */
export let timingLine = (
  method: string,
  url: string | URL,
  res: Answer,
) => {
  let entries = res.headers.get('server-timing')
  return `${method.toUpperCase()} ${target(url)} ${res.status}${
    entries ? `  ${entries}` : ''
  }`
}

/** Every response a CLI receives passes here; only the line is added. */
export let noted = <R extends Answer>(
  method: string,
  url: string | URL,
  res: R,
): R => {
  if (timing.on) timing.say(timingLine(method, url, res))
  return res
}
