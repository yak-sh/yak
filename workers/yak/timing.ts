// Where a request's time went, as a header anyone can read: one stopwatch per
// request, each stage named, emitted as `Server-Timing` — the standard the
// browser's own network panel already knows how to draw. Serving an app's
// file is a chain of round trips (the directory, the app's own worker, the
// bytes), each of them to a service whose home may be an ocean away, and
// until this existed the only thing anyone could see was the second the whole
// chain took. A stage that grew is now visible in a curl.
//
// The clock is `Date.now()` unless a caller hands the stopwatch its own, and
// in a Worker it advances only when I/O completes — so a mark measures
// waiting and reads zero for pure compute. That is exactly the thing being
// measured here; a stage that is slow because of CPU belongs in a profile, not
// a header.
//
// Three entries carry a count in `dur` rather than milliseconds: `hops`, the
// round trips this request made to a store (door.ts), `stmts`, the statements
// those stores ran, and `r2`, the operations
// it made against the bucket (lib/objects.ts `counted`). Server-Timing has no unit
// but time, and a count is worth more than the field's tidiness: a duration
// cannot tell one slow wait from forty fast ones, and forty fast ones is the
// bug we keep writing. `hops;dur=7` is an N+1 read straight off a curl.
//
// `wake` is milliseconds again, and appears only when a store this request
// reached had to start first (graph.ts `#fetch`): what those stores waited
// for while starting. Their compute is not in it, since a store's clock moves
// only across I/O; the difference is in the stage that called them.
//
// Every `<name>_wait` is milliseconds spent waiting on one kind of service,
// summed over the request wherever it waited (hops.ts `elapsed`), a store's
// own waits included: `directory_wait` and `store_wait` at the door onto a
// store (door.ts), `copy_wait` on the serving copy (directory-copy.ts),
// `r2_wait` on the bucket, `analytics_wait` on Cloudflare's SQL API for visit
// counts (views.ts).
import { counts, type Tally, tallying } from './lib/hops.ts'

export type Clock = ReturnType<typeof clock>

export let clock = (now: () => number = Date.now) => {
  let marks: string[] = []
  let sums = new Map<string, number>()
  let tally: Tally = new Map()
  let born = now()
  let mark = (name: string, ms: number, desc?: string | null) =>
    marks.push(`${name};dur=${ms}${desc ? `;desc=${desc}` : ''}`)
  return {
    // One stage that happens many times — a put per file — summed under one
    // name, so a twenty-file write reads as one `put` and not twenty.
    sum: (name: string) => async <T>(work: () => Promise<T>): Promise<T> => {
      let at = now()
      try {
        return await work()
      } finally {
        sums.set(name, (sums.get(name) ?? 0) + now() - at)
      }
    },
    // One stage: whatever it answers is answered on, and the time it took is
    // recorded either way — a stage that threw is the one worth seeing.
    //
    // `said` is for a stage whose duration is only half the story: serving a
    // file is fast or slow because Cloudflare's cache hit or missed (cache.ts),
    // and `Cf-Cache-Status` is the word for which. It rides the same
    // Server-Timing entry as `desc`, which is where the standard puts it, so
    // reading a request still means reading one header.
    time: async <T>(
      name: string,
      work: () => Promise<T>,
      said?: (out: T) => string | null,
    ): Promise<T> => {
      let at = now()
      let out
      try {
        return out = await work()
      } finally {
        mark(name, now() - at, out === undefined ? null : said?.(out))
      }
    },
    // Timings from a trusted internal service, already named for that service.
    // Keep its native-runtime CPU durations, not the Worker's I/O-only clock.
    include: (header: string | null) => {
      if (header) marks.push(header)
    },
    // A stage that is not one call: `since()` hands back the marker.
    since: () => {
      let at = now()
      return (name: string) => mark(name, now() - at)
    },
    // The request's round trips, counted wherever they are made rather than
    // threaded down to them (hops.ts): run the whole request in here and
    // everything it awaits lands on this clock's tally.
    counting: <T>(work: () => T) => tallying(tally, work),
    header: (prefix = '') => {
      let { hops, r2 } = counts(tally)
      return [
        ...marks,
        ...[...sums].map(([name, ms]) => `${name};dur=${ms}`),
        `hops;dur=${hops}`,
        `stmts;dur=${tally.get('stmts') ?? 0}`,
        ...(tally.has('rows') ? [`rows;dur=${tally.get('rows')}`] : []),
        ...(tally.has('wake') ? [`wake;dur=${tally.get('wake')}`] : []),
        ...[...tally].filter(([name]) => name.endsWith('_wait')).map((
          [name, ms],
        ) => `${name};dur=${ms}`),
        `r2;dur=${r2}`,
        `total;dur=${now() - born}`,
      ].map((mark) => mark.replace(/(^|, )(\w+);/g, `$1${prefix}$2;`)).join(
        ', ',
      )
    },
  }
}

// The header onto a response. A 101 carries the runtime's own socket: the
// runtime's Response takes it over (`webSocket`), as the router's own
// headers do (kernel.ts `handler`), and one with no socket to hand over is
// left untouched — the same rule apps.ts `reporting` reads.
export let timed = (res: Response, c: Clock, prefix = '') => {
  let headers = new Headers(res.headers)
  headers.set('server-timing', c.header(prefix))
  return headed(res, headers)
}

/** The answer again under other headers, a socket's handshake included. */
export let headed = (res: Response, headers: Headers): Response => {
  let socket = (res as { webSocket?: unknown }).webSocket
  if (res.status == 101 && !socket) return res
  let out = new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
    ...socket ? { webSocket: socket } : {},
  } as ResponseInit)
  // A runtime with no socket of its own (Deno) keeps it on the object.
  if (socket && !(out as { webSocket?: unknown }).webSocket) {
    Object.assign(out, { webSocket: socket })
  }
  return out
}
