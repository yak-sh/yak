// The relay: the values the server forwards without storing.
//
// A `sync: peers` component is somebody's cursor, caret or presence dot. The
// server is not where it belongs — it is only the one place that can see
// every subscriber, so it forwards. Nothing is written: no row, no journal
// line, no commit, and therefore no `effect` phase and no subscription
// running its query again. A relayed value is a message that happens to be
// shaped like a patch.
//
// What makes it more than a broadcast is the LIFETIME the component declares
// (@yaks/vocab `durable`). The relay holds the last value per (entity,
// component) under the CONNECTION that sent it, so three things are possible
// that a plain broadcast cannot do:
//
//   a subscriber that connects LATE is sent what is already there
//   a connection that CLOSES clears every value it was relaying
//   a value with a duration clears itself, its timer restarted on each write
//
// All three send the same thing — a `{comp: null}` bundle to the other
// connections — so this file implements it once.
//
// The connection is a type parameter. This module never asks what one IS: the
// subscription registry keys by its `Sink`, and a test keys by a string.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import { comps } from '@yaks/graph'
import { durableOf, ms, syncOf, type Vocab } from '@yaks/vocab'

/** How a timer is set, so a test can control the clock. Returns the function
 * that cancels it. */
export type Timer = (fn: () => void, after: number) => () => void

let clock: Timer = (fn, after) => {
  let t = setTimeout(fn, after)
  return () => clearTimeout(t)
}

/** One value the relay is holding: which entity, which component, and the
 * patch last sent for it. */
export type Holding = { eid: Eid; comp: string; patch: Comp }

/** The relay over one graph's vocabulary. */
export type Relay<C> = {
  /**
   * Relayed bundles from one connection: held, and returned as the bundles
   * to forward. Components that do not declare `sync: peers` are dropped —
   * the relay forwards, it does not store, so a durable component sent here
   * would silently vanish.
   */
  write: (conn: C, bundles: Bundle[]) => Bundle[]
  /** What one connection is holding, as `"<eid> <comp>"` keys — small enough
   * to store somewhere that survives losing this process's memory. */
  holds: (conn: C) => string[]
  /** Take those keys back, without their values, so a close can still clear
   * them. */
  adopt: (conn: C, keys: string[]) => void
  /** What a subscriber connecting now should be sent: every OTHER
   * connection's held values, for the entities it can see. */
  snapshot: (mine: C, sees: (eid: Eid) => boolean) => Bundle[]
  /** A connection went away: forget it, and return the nulls to forward. */
  drop: (conn: C) => Bundle[]
  /** Cancel every timer — for a shutdown, so nothing is left running. */
  close: () => void
}

let KEY = ' ' // the one character a component name cannot hold
let key = (eid: Eid, comp: string) => eid + KEY + comp
let split = (k: string): [Eid, string] => {
  let at = k.indexOf(KEY)
  return [k.slice(0, at), k.slice(at + 1)]
}

/** One bundle clearing a component — the same bundle a clear, a close and an
 * expiry all produce. */
let cleared = (eid: Eid, comp: string): Bundle => ({
  entity: { eid },
  [comp]: null,
})

/**
 * A relay. `expire` is how a value that ran out of time reaches the
 * subscribers — the registry passes its own broadcast function, so an expiry
 * looks to a client exactly like the writer clearing the value.
 */
export let relay = <C>(
  vocab: Vocab,
  expire: (bundles: Bundle[]) => void,
  timer: Timer = clock,
): Relay<C> => {
  // conn → key → the value it last sent. A Map per connection, so forgetting
  // a connection is one delete and the iteration order is the write order.
  let held = new Map<C, Map<string, Comp | null>>()
  // conn → key → cancel. Separate because most values have no timer at all.
  let timers = new Map<C, Map<string, () => void>>()

  let cancel = (conn: C, k: string) => {
    let mine = timers.get(conn)
    mine?.get(k)?.()
    mine?.delete(k)
  }

  let forget = (conn: C, k: string) => {
    cancel(conn, k)
    held.get(conn)?.delete(k)
  }

  let write = (conn: C, bundles: Bundle[]): Bundle[] => {
    let out: Bundle[] = []
    for (let b of bundles) {
      let eid = b.entity?.eid
      if (!eid) continue
      let sent: Bundle = { entity: { eid } }
      let said = false
      for (let [name, patch] of comps(b)) {
        if (syncOf(vocab, name) != 'peers') continue
        let k = key(eid, name)
        let mine = held.get(conn)
        if (patch == null) {
          forget(conn, k)
          sent[name] = null
          said = true
          continue
        }
        if (!mine) held.set(conn, mine = new Map())
        // A relayed value is a PATCH like any other: what is held is the
        // merge, what is forwarded is only what this write carried.
        mine.set(k, { ...mine.get(k), ...patch })
        sent[name] = patch
        said = true
        // The timer restarts on every write: a cursor that keeps moving keeps
        // its value alive, and one that stops is cleared after the declared
        // duration.
        cancel(conn, k)
        let span = ms(durableOf(vocab, name))
        if (span == null) continue
        let clocks = timers.get(conn) ?? new Map<string, () => void>()
        timers.set(conn, clocks)
        clocks.set(
          k,
          timer(() => {
            forget(conn, k)
            expire([cleared(eid, name)])
          }, span),
        )
      }
      if (said) out.push(sent)
    }
    return out
  }

  return {
    write,
    holds: (conn) => [...held.get(conn)?.keys() ?? []],
    adopt: (conn, keys) => {
      // Stored without values on purpose: this is what is left after the
      // process forgot what it was holding, and clearing a component needs no
      // value.
      let mine = held.get(conn) ?? new Map<string, Comp | null>()
      held.set(conn, mine)
      for (let k of keys) if (!mine.has(k)) mine.set(k, null)
    },
    snapshot: (mine, sees) => {
      let out = new Map<Eid, Bundle>()
      for (let [conn, values] of held) {
        if (conn === mine) continue
        for (let [k, patch] of values) {
          // adopted after a restart, so its value is not known any more
          if (patch == null) continue
          let [eid, comp] = split(k)
          if (!sees(eid)) continue
          let b = out.get(eid) ?? { entity: { eid } }
          b[comp] = patch
          out.set(eid, b)
        }
      }
      return [...out.values()]
    },
    drop: (conn) => {
      let mine = held.get(conn)
      held.delete(conn)
      for (let off of timers.get(conn)?.values() ?? []) off()
      timers.delete(conn)
      return [...mine?.keys() ?? []].map((k) => cleared(...split(k)))
    },
    close: () => {
      for (let mine of timers.values()) for (let off of mine.values()) off()
      timers.clear()
      held.clear()
    },
  }
}

/** Every value one connection is holding, as one record per (entity,
 * component) — {@link Relay.holds}'s keys, split back apart for a reader. */
export let holding = <C>(r: Relay<C>, conn: C): Holding[] =>
  r.holds(conn).map((k) => {
    let [eid, comp] = split(k)
    return { eid, comp, patch: {} }
  })
