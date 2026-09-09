// Monitor's wake channel: the shared bus selection, but one stdout line per
// event and a durable notified receipt. Ordinary agent queries remain read-only.
import {
  busRows,
  httpQuery,
  idOf,
  noticeEvents,
  type Querier,
  type Reader,
  readerFor,
  readerRows,
  type Row,
  send,
} from './client.ts'
import { safe } from './terminal.ts'
import type { Change } from './types.ts'

// A poll is a fresh candidate snapshot, not a timestamp cursor: verification,
// claims and settlement can make an older row newly eligible. Only identities
// actually printed (or already stamped) are removed from the next delta.
export let inboxDelta = (
  all: Row[],
  who: Reader,
  seen: ReadonlySet<string>,
) => {
  let byEid = new Map(all.map((r) => [r.eid, r]))
  let events = noticeEvents(
    all,
    who,
    (eid) => seen.has(eid) || !!byEid.get(eid)?.comps.notified,
  )
  return events.map((ev) => {
    let r = byEid.get(ev.eid)!
    let ref = (eid: unknown) => {
      let row = byEid.get(String(eid))
      return row ? idOf(row) : String(eid ?? '')
    }
    let first = (text: string) =>
      safe(text.split(/[\r\n\u2028\u2029]/)[0]).trim()
    let from = ev.meta.from?.replace(' · via ', ' via ') ||
      ref(r.comps.created?.by) || '—'
    let on = ev.meta.on || ref(r.comps.knock?.target ?? r.comps.mail?.target) ||
      '—'
    return {
      eid: ev.eid,
      line: [ev.meta.kind, from, on, ev.content].map(first).join(' · '),
    }
  })
}

// Injected I/O keeps the empty-poll and failure contract in the fast tier.
// Reads MUST go to the server: a CLI local-read arm would conceal its death.
export let followInbox = async (
  session: string,
  cwd: string,
  interval: number,
  write: (line: string) => void,
  io: {
    query: Querier
    stamp: (changes: Change[]) => Promise<unknown>
    pause: (ms: number) => Promise<unknown>
  } = {
    query: httpQuery,
    stamp: send,
    pause: (ms) => new Promise((go) => setTimeout(go, ms)),
  },
) => {
  if (!Number.isInteger(interval) || interval < 1 || interval > 2147483647) {
    throw new Error(
      '--interval must be a positive integer in milliseconds (max 2147483647)',
    )
  }
  let seen = new Set<string>()
  for (;;) {
    let base = await readerRows(session, io.query)
    let who = readerFor(base, session, cwd)
    if (!who.session) throw new Error(`session not found: ${session}`)
    let candidates = await busRows(who, io.query)
    // Candidate/byline queries overlap. One entity must reach the selector once.
    let all = [
      ...new Map([...base, ...candidates].map((r) => [r.eid, r])).values(),
    ]
    for (let { eid, line } of inboxDelta(all, who, seen)) {
      write(line) // console.log writes a complete line immediately, even to a pipe
      seen.add(eid)
      await io.stamp([{ eid, name: 'notified', comp: {} }])
    }
    await io.pause(interval) // silence is not EOF
  }
}
