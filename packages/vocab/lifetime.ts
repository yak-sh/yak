// Two questions a component answers about its own state, where there used to
// be one word for both. `persist` conflated them: it said "wire" for a thing
// the server owns and stores, and there was no way to say "tell my peers, but
// do not keep it".
//
//   sync     who hears about a write — nobody, the server, or the peers
//   durable  how long the value lives, asked of whoever owns it
//
// They are independent. A cursor position is `sync: peers, durable:
// connection` — everybody watching sees it, nobody stores it, and it goes away
// with the tab that wrote it. A saved draft is `sync: none, durable: forever` —
// nobody else hears about it, and this browser keeps it across a reload. A task
// is the default, `sync: server, durable: forever`.
//
// The words are CORE vocabulary, not @yaks/sync's, because the server reads
// them: admission, the subscription registry and the store all decide from
// them, and a keyword only a browser package declared would not be on the
// meta-schema a server validates against.

/** Who hears about a write to a component. */
export type Sync = 'none' | 'server' | 'peers'

/** The three, in the order they widen. */
export let SYNC: Sync[] = ['none', 'server', 'peers']

/** A `sync` declaration read off a schema — `server` when it says nothing, the
 * common case being data the server owns, so a vocabulary written for a server
 * needs no keyword at all. */
export let said = (sync: unknown): Sync =>
  SYNC.includes(sync as Sync) ? sync as Sync : 'server'

/** A `durable` declaration read off a schema — `forever` when it says
 * nothing. */
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
 * A `durable` word in milliseconds — `null` when it names no duration.
 * `forever` and `connection` are spans a clock cannot count, so they answer
 * `null` too: a caller asks {@link ms} to decide whether to set a timer, and
 * compares the word itself for the rest.
 */
export let ms = (durable: string): number | null => {
  let m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(durable)
  return m ? Number(m[1]) * UNIT[m[2]] : null
}

/** Whether a `durable` word is one this model knows: the two boundaries, or a
 * duration. */
export let lives = (durable: string): boolean =>
  durable == 'forever' || durable == 'connection' || ms(durable) != null
