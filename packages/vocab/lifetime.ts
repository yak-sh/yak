// Two things a component declares about its own state, where an earlier
// keyword covered both. The old `persist` conflated them: its value `wire`
// meant a value the server owns and stores, and there was no way to declare
// "send this to the other clients, but do not store it".
//
//   sync     who is told about a write — nobody, the server, or the peers
//   durable  how long the value lives, asked of whoever owns it
//
// They are independent. A cursor position is `sync: peers, durable:
// connection` — everybody watching sees it, nobody stores it, and it goes away
// with the tab that wrote it. A saved draft is `sync: none, durable: forever` —
// no one else is told about it, and this browser keeps it across a reload. A
// task is the default, `sync: server, durable: forever`.
//
// Both keywords are core, not @yaks/sync's, because the server reads them: the
// write allowlist, the subscription registry and the store all decide from
// them, and a keyword only a browser package declared would not be on the
// meta-schema a server validates against.

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
