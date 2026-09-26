// What a component declares about its own state, where an earlier keyword
// covered the first two. The old `persist` conflated them: its value `wire`
// meant a value the server owns and stores, and there was no way to declare
// "send this to the other clients, but do not store it".
//
//   sync     who is told about a write — nobody, the server, or the peers
//   durable  how long the value lives, asked of whoever owns it
//   pace     how often a relayed value is sent: a page that moves something
//            every frame writes every frame, and the peers hear the latest
//            value once a pace (@yaks/sync pace.ts)
//
// `sync` and `durable` are independent. A cursor position is `sync: peers,
// durable: connection` — everybody watching sees it, nobody stores it, and it
// goes away with the tab that wrote it. A saved draft is `sync: none, durable:
// forever` — no one else is told about it, and this browser keeps it across a
// reload. A task is the default, `sync: server, durable: forever`. `pace`
// belongs beside `sync: peers` only: a relayed value is the one a page may
// write sixty times a second.
//
// The keywords are core, not @yaks/sync's: the write allowlist, the
// subscription registry and the store all decide from `sync` and `durable`,
// and a server validates every document against the meta-schema, which a
// keyword only a browser package declared would not be on.

/** Who is told about a write to a component. */
export type Sync = 'none' | 'server' | 'peers'

/** The three, in the order they widen. */
export let SYNC: Sync[] = ['none', 'server', 'peers']

/** The `sync` value a schema declares — `server` when it declares none, the
 * common case being data the server owns, so a vocabulary written for a server
 * needs no keyword at all. */
export let said = (sync: unknown): Sync =>
  SYNC.includes(sync as Sync) ? sync as Sync : 'server'

/** The `durable` value a schema declares — `forever` when it declares
 * none. */
export let kept = (durable: unknown): string =>
  typeof durable == 'string' && durable ? durable : 'forever'

let UNIT: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

/**
 * A `durable` value in milliseconds — `null` when it names no duration.
 * `forever` and `connection` are spans a clock cannot count, so they return
 * `null` too: a caller uses {@link ms} to decide whether to set a timer, and
 * compares the string itself for the rest.
 */
export let ms = (durable: string): number | null => {
  let m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(durable)
  return m ? Number(m[1]) * UNIT[m[2]] : null
}

/** Whether a `durable` value is one this package understands: either of the
 * two named spans, or a duration. */
export let lives = (durable: string): boolean =>
  durable == 'forever' || durable == 'connection' || ms(durable) != null

/** A `pace` value in milliseconds — `null` when a component declares none, or
 * none a clock can count, and every write is sent as it is made. */
export let paced = (pace: unknown): number | null =>
  typeof pace == 'string' ? ms(pace) || null : null
