// Where a request's time went, as a header anyone can read: one stopwatch per
// request, each stage named, emitted as `Server-Timing` — the standard the
// browser's own network panel already knows how to draw. Serving an app's
// file is a chain of round trips (the directory, the app's own worker, the
// bytes), each of them to a service whose home may be an ocean away, and
// until this existed the only thing anyone could see was the second the whole
// chain took. A stage that grew is now visible in a curl.
//
// The clock is `Date.now()`, which in a Worker advances only when I/O
// completes — so a mark measures WAITING and reads zero for pure compute.
// That is exactly the thing being measured here; a stage that is slow because
// of CPU belongs in a profile, not a header.
//
// Two entries carry a COUNT in `dur` rather than milliseconds: `hops`, the
// round trips this request made to a store (door.ts), and `r2`, the operations
// it made against the bucket (blobs.ts `counted`). Server-Timing has no unit
// but time, and a count is worth more than the field's tidiness: a duration
// cannot tell one slow wait from forty fast ones, and forty fast ones is the
// bug we keep writing. `hops;dur=7` is an N+1 read straight off a curl.
import { counts, type Tally, tallying } from '../../src/hops.ts'

export type Clock = ReturnType<typeof clock>

export let clock = () => {
  let marks: string[] = []
  let sums = new Map<string, number>()
  let tally: Tally = new Map()
  let born = Date.now()
  let mark = (name: string, ms: number, desc?: string | null) =>
    marks.push(`${name};dur=${ms}${desc ? `;desc=${desc}` : ''}`)
  return {
    // One stage that happens many times — a put per file — summed under one
    // name, so a twenty-file write reads as one `put` and not twenty.
    sum: (name: string) => async <T>(work: () => Promise<T>): Promise<T> => {
      let at = Date.now()
      try {
        return await work()
      } finally {
        sums.set(name, (sums.get(name) ?? 0) + Date.now() - at)
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
      let at = Date.now()
      let out
      try {
        return out = await work()
      } finally {
        mark(name, Date.now() - at, out === undefined ? null : said?.(out))
      }
    },
    // A stage that is not one call: `since()` hands back the marker.
    since: () => {
      let at = Date.now()
      return (name: string) => mark(name, Date.now() - at)
    },
    // The request's round trips, counted wherever they are made rather than
    // threaded down to them (hops.ts): run the whole request in here and
    // everything it awaits lands on this clock's tally.
    counting: <T>(work: () => T) => tallying(tally, work),
    header: () => {
      let { hops, r2 } = counts(tally)
      return [
        ...marks,
        ...[...sums].map(([name, ms]) => `${name};dur=${ms}`),
        `hops;dur=${hops}`,
        `r2;dur=${r2}`,
        `total;dur=${Date.now() - born}`,
      ].join(', ')
    },
  }
}

// The header onto a response. A 101 carries the runtime's own socket and no
// Response constructor here can copy it, so a socket keeps its handshake
// untouched — the same rule apps.ts `reporting` reads.
export let timed = (res: Response, c: Clock) => {
  if (res.status == 101) return res
  let headers = new Headers(res.headers)
  headers.set('server-timing', c.header())
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}
