// The relay: the values the server forwards without storing.
//
// A `sync: peers` component is somebody's cursor, caret or presence dot. The
// server is not where it belongs — it is only the one place that can see
// every subscriber, so it forwards. Nothing is written: no row, no journal
// line, no commit, and therefore no `effect` phase and no subscription
// running its query again. A relayed value is a message that happens to be
// shaped like a patch.
//
// What makes it more than a broadcast is the lifetime the component declares
// (@yaks/vocab `durable`). The relay holds one value per (entity, component),
// the one every client holds too, under the connection that last wrote it, so
// three things are possible that a plain broadcast cannot do:
//
//   a subscriber that connects late is sent what is already there
//   a connection that closes clears every value it still holds
//   a value with a duration clears itself, its timer restarted on each write
//
// All three send the same thing — a `{comp: null}` bundle to the other
// connections — so this file implements it once.
//
// A write from another connection takes a value over, so a close clears only
// what its connection said last. That is what lets a page move to a new
// connection: it says its values again there, and then the old connection's
// close, whenever the server hears it, clears none of them, and no answer
// hands the page back an older copy of its own (@yaks/sync saying.ts).
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
   * Relayed bundles from one connection: held under it, taking over any value
   * another connection said of the same component, and returned as the
   * bundles to forward. A clear clears the value whoever said it. Components
   * that do not declare `sync: peers` are dropped — the relay forwards, it
   * does not store, so a durable component sent here would silently vanish.
   */
  write: (conn: C, bundles: Bundle[]) => Bundle[]
  /** What one connection is holding, as `"<eid> <comp>"` keys — small enough
   * to store somewhere that survives losing this process's memory. */
  holds: (conn: C) => string[]
  /** Take those keys back, without their values, so a close can still clear
   * them. A key another connection holds stays with it. */
  adopt: (conn: C, keys: string[]) => void
  /** What a subscriber connecting now should be sent: every value another
   * connection holds, for the entities it can see. What it holds itself, it
   * already has. */
  snapshot: (mine: C, sees: (eid: Eid) => boolean) => Bundle[]
  /** A connection went away: forget it, and return the nulls to forward for
   * what it still held. */
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
  // key → the connection that said it last, and the value as it now stands:
  // null when it was adopted after a lost memory, and only its key is known.
  let held = new Map<string, { conn: C; patch: Comp | null }>()
  // conn → the keys it holds, in the order it first said them.
  let saying = new Map<C, Set<string>>()
  // key → cancel. Separate because most values have no timer at all.
  let timers = new Map<string, () => void>()

  let cancel = (k: string) => {
    timers.get(k)?.()
    timers.delete(k)
  }

  let forget = (k: string) => {
    cancel(k)
    let was = held.get(k)
    if (was) saying.get(was.conn)?.delete(k)
    held.delete(k)
  }

  let hold = (conn: C, k: string, patch: Comp | null) => {
    let was = held.get(k)
    if (was && was.conn !== conn) saying.get(was.conn)?.delete(k)
    held.set(k, { conn, patch })
    let mine = saying.get(conn) ?? new Set<string>()
    saying.set(conn, mine)
    mine.add(k)
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
        said = true
        if (patch == null) {
          forget(k)
          sent[name] = null
          continue
        }
        // A relayed value is a PATCH like any other: what is held is the
        // merge onto the value as it stands, whoever said it, as every client
        // merges it; what is forwarded is only what this write carried.
        hold(conn, k, { ...held.get(k)?.patch, ...patch })
        sent[name] = patch
        // The timer restarts on every write: a cursor that keeps moving keeps
        // its value alive, and one that stops is cleared after the declared
        // duration.
        cancel(k)
        let span = ms(durableOf(vocab, name))
        if (span == null) continue
        timers.set(
          k,
          timer(() => {
            forget(k)
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
    holds: (conn) => [...saying.get(conn) ?? []],
    adopt: (conn, keys) => {
      // Stored without values on purpose: this is what is left after the
      // process forgot what it was holding, and clearing a component needs no
      // value.
      for (let k of keys) if (!held.has(k)) hold(conn, k, null)
    },
    snapshot: (mine, sees) => {
      let out = new Map<Eid, Bundle>()
      for (let [k, { conn, patch }] of held) {
        if (conn === mine) continue
        // adopted after a restart, so its value is not known any more
        if (patch == null) continue
        let [eid, comp] = split(k)
        if (!sees(eid)) continue
        let b = out.get(eid) ?? { entity: { eid } }
        b[comp] = patch
        out.set(eid, b)
      }
      return [...out.values()]
    },
    drop: (conn) => {
      let mine = [...saying.get(conn) ?? []]
      saying.delete(conn)
      for (let k of mine) {
        cancel(k)
        held.delete(k)
      }
      return mine.map((k) => cleared(...split(k)))
    },
    close: () => {
      for (let off of timers.values()) off()
      timers.clear()
      held.clear()
      saying.clear()
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
