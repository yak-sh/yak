// One socket's serving ORDER. A view mounting sends `{sub,q}` and waits on the
// first frame back; a board load sends a dozen at once and ONE thread answers
// them (subserve, on the socket's wsworker), so in arrival order a 142-byte
// tally waits behind a 900 KB route — measured on the live graph: 970ms for an
// answer whose own cost is 9ms (T-33753). Head-of-line blocking, and the ask
// is scheduling, not a smaller answer.
//
// So this sits between the socket and subserve: it GATHERS the burst — hopping
// until no new frame lands between two hops, since a worker is handed one
// message per turn — and then answers CHEAPEST FIRST. Nothing is
// preempted (a synchronous query evaluation cannot be) and nothing is dropped;
// only the order changes. Two exceptions, both of them the client's own word:
// a frame that is not a `{sub}` is served straight through (a join opens the
// stream, and everything behind it is a read), and an `{unsub}` CANCELS a sub
// still waiting — the client stopped watching before anyone paid for it.
import type { Sql } from './store/sql.ts'
import { aggOf, parseQuery } from './query.ts'
import { locate, vocabOf } from './db.ts'
import { comps, derivedProps, stamped } from './types.ts'

// A control frame as it arrives off the socket: subserve parses it, this only
// reads the two words that decide ORDER (`sub` names one, `q` prices it).
type Ctl = Record<string, unknown>

// A column the VOCABULARY closes: a tally over it answers a handful of keys
// however many rows it counted. Read across all three readable maps — a board's
// tally is over task.status, which is DERIVED, and the enum is what matters
// here, not where the value comes from.
let closed = (comp: string, prop: string) => {
  let t = comps[comp]?.[prop] ?? stamped[comp]?.[prop] ??
    derivedProps[comp]?.[prop]
  return typeof t == 'object' && t != null && 'enum' in t
}

// What a sub is expected to COST, cheapest first. An answer's size is known
// only once it is computed, so this ranks what the query DECLARES about its own:
//
//   0 — the socket's OWN PAGE: a sub that names the entity the handshake seeded
//       (`route:<seed>`, `id=<seed>`, `.comment.target=<seed>`). The tab opened
//       on that entity, so its card comes before the shell around it — the
//       tray's session strip and the rail's tiles arrive in the same burst and
//       were answering first, the page's own route last (T-37445).
//   1 — a BOUNDED aggregate: `.count!` (one number), or a tally/distinct over a
//       closed-set column (`.tally=task.status`). One indexed statement, and an
//       answer bounded by the vocabulary rather than by the graph.
//   2 — everything else: a membership set, a route's whole entity, and an
//       aggregate over an OPEN column — `.tally=comment.target` is one key per
//       commented entity, 161 KB on the live graph. Bounded only by the data.
//
// Deliberately coarse: addressedness does not predict cost (`route:<project>`
// is the most expensive frame a board load sends), and a finer model would be
// guessing where this one is reading a declaration.
export let cost = (db: Sql, q: string, name = '', seed?: string) => {
  if (seed && (name.includes(seed) || q.includes(seed))) return 0
  try {
    let agg = aggOf(parseQuery(q, vocabOf(db)))
    if (!agg) return 2
    return agg.op == 'count' || closed(agg.at.comp, agg.at.prop) ? 1 : 2
  } catch {
    // A line this side cannot parse is one subserve will answer with its own
    // error frame. Cheapness is a claim; absent the parse, don't make it.
    return 2
  }
}

export let subqueue = (db: Sql, serve: (f: Ctl) => void) => {
  let pending: { name: string; cost: number; f: Ctl }[] = []
  let draining = false
  // A frame landed since the last hop: the burst is still arriving.
  let dirty = false
  // The entity this socket booted on, from the join's `seed` (subserve.ts).
  let seed: string | undefined

  // The cheapest waiting sub — but never out of order with ITSELF: a client may
  // re-subscribe the same name (a board replacing its query), and those two
  // frames are one conversation, so only each name's FIRST entry can be picked.
  let take = () => {
    let seen = new Set<string>()
    let at = 0
    let best = Infinity
    for (let i = 0; i < pending.length && best > 0; i++) {
      let p = pending[i]
      if (seen.has(p.name)) continue
      seen.add(p.name)
      if (p.cost < best) [best, at] = [p.cost, i]
    }
    return pending.splice(at, 1)[0]
  }

  // A MessageChannel hop, not setTimeout: chained timers are clamped to ~2ms
  // each once they nest, a tax on exactly the burst this exists to speed up.
  // The channel lives for the drain — an open port holds the event loop open,
  // which is right while there is queued work and wrong once there isn't.
  let drain = async () => {
    draining = true
    let hops = new MessageChannel()
    let waiting: (() => void)[] = []
    hops.port1.onmessage = () => waiting.shift()?.()
    let turn = () =>
      new Promise<void>((go) => {
        waiting.push(go)
        hops.port2.postMessage(0)
      })
    try {
      while (pending.length) {
        // A worker is handed ONE message per turn, so a burst lands one frame
        // per hop, interleaved with this hop: picking after a single hop sees
        // one frame of lookahead. Keep hopping while frames are still landing
        // (bounded, ~0.1 ms each), and pick once the burst has settled.
        let hops = 0
        do {
          dirty = false
          await turn()
        } while (dirty && ++hops < 32)
        // An unsubscribe may cancel the last ask during the channel hop.
        let next = take()
        if (next) serve(next.f)
      }
    } finally {
      draining = false
      hops.port1.close()
      hops.port2.close()
    }
  }

  // The socket's whole control stream. A `{sub}` is queued; anything else is
  // this client saying something about subs it already asked for, and is served
  // now — an `{unsub}` first cancelling the answer nobody is waiting for.
  let push = (f: Ctl) => {
    if (typeof f.unsub == 'string') {
      pending = pending.filter((p) => p.name != f.unsub)
    }
    if (typeof f.seed == 'string') seed = locate(db, f.seed) ?? f.seed
    if (typeof f.sub != 'string') return serve(f)
    let q = typeof f.q == 'string' ? f.q : ''
    pending.push({ name: f.sub, cost: cost(db, q, f.sub, seed), f })
    dirty = true
    if (!draining) drain()
  }

  return { push }
}
