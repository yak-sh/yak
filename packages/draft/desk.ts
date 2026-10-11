/**
 * A person's drafts, as an interface they type in holds them. `desk(client,
 * opts)` binds them to the graph that keeps them, and each place the person
 * types in reads its text (`text`), keeps what is typed (`type`), and ends it
 * when it is sent or discarded (`spend`).
 *
 * A keystroke costs no round trip: `text` answers it at once, and the stash
 * (Web Storage, which answers at once) keeps it, so a crash, a closed tab or a
 * store out of reach loses nothing; the next load finds it there and sends it.
 * The store is written at most once a pace per draft, one write in flight at
 * a time, each saying the text it was typed over (`typed{over}`), and the
 * store merges (./plugin.ts), keeping what another interface wrote meanwhile.
 * The store's answer, and every text another interface makes it hold, is
 * heard by its `rev`, newest last, and what was typed here since is merged
 * onto it (./merge.ts): neither side's typing is dropped. A draft ends when
 * its text is emptied, in the same batch as the send it went into.
 *
 * @module
 */

import { batch, effect, type Signal, signal, untracked } from '@preact/signals'
import { type Bundle, derivedEid } from '@yaks/graph'
import { merge } from './merge.ts'

/** The eid of the draft `by` types in `place`: the same in every interface,
 * so each finds the one the others write.
 *
 * ```ts
 * import { assertEquals, assertNotEquals } from '@std/assert'
 * import { draftEid } from '@yaks/draft'
 *
 * assertEquals(draftEid('jo', 'search'), draftEid('jo', 'search'))
 * assertNotEquals(draftEid('jo', 'search'), draftEid('al', 'search'))
 * ```
 */
export let draftEid = (by: string, place: string): string =>
  derivedEid(['draft', by, place].join('|'))

/** As much of a graph as a desk needs: a write answered with the batch as
 * the store took it, and a watch. A @yaks/client `client()` is one. */
export type Client = {
  mutate: (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>
  watch: (query: string) => {
    value: Bundle[]
    subscribe: (fn: (rows: Bundle[]) => void) => () => void
    close?: () => void
  }
}

/** Where what the store has not taken yet is kept across a reload: the part
 * of Web Storage a desk uses. `localStorage` is one. */
export type Stash = Pick<
  Storage,
  'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'
>

/** What a desk offers each place a person types in. */
export type Drafts = {
  /** what is typed in `place` and not yet sent ('' for nothing), read
   * reactively */
  text: (place: string) => string
  /** the person typed: keep it */
  type: (place: string, text: string) => void
  /** it was sent, or discarded: empty it at once, in one batch with `also`
   * (the send it went into) */
  spend: (place: string, also?: Bundle[]) => Promise<boolean>
  /** Restore text from another source, preserving subsequent typing.
   * `over` is the source text already imported (default: empty). */
  restore: (place: string, text: string, over?: string) => void
}

/** What a desk is bound with. */
export type DeskOpts = {
  /** whose drafts they are: the person, read reactively, and nobody yet
   * while it is not known (typing is kept, and written once it is) */
  by: () => string | undefined
  /** where untaken text waits across a reload (default: nowhere) */
  stash?: Stash
  /** the least time between two writes of one draft, in ms (default 500) */
  pace?: number
  /** a write the store refused; the text stays, and goes with the next */
  report?: (err: unknown) => void
}

// The store's text, and which revision of it.
type Word = { text: string; rev: number }

// One draft as this interface holds it.
type Held = {
  /** the store's text as last heard, and its rev */
  base: string
  rev: number
  /** what is typed here */
  local: string
  /** the write the store has not answered: its number and its text */
  flying?: number
  sent?: string
  /** the newest text heard while waiting on it */
  later?: Word
  /** when the last write left */
  left: number
  /** the store refused the last write: the next waits for more typing */
  stuck?: boolean
}

let fresh = (): Held => ({ base: '', rev: 0, local: '', left: 0 })

// The store's text heard. A newer one is the new base, and what was typed
// here since is merged onto it. While a write is in flight the answer to it
// comes first, since it may already hold this text; the newest waits.
let heard = (h: Held, w: Word): Held =>
  w.rev <= h.rev
    ? h
    : h.flying != null
    ? { ...h, later: h.later && h.later.rev >= w.rev ? h.later : w }
    : { ...h, base: w.text, rev: w.rev, local: merge(h.base, h.local, w.text) }

// The answer to write `n`: the store's text once it took it. What was typed
// while it flew is merged onto it, and a newer text heard meanwhile after.
// An answer to a write since overtaken is only a text heard.
let answered = (h: Held, n: number, w: Word): Held => {
  if (h.flying != n) return heard(h, w)
  let next = landed(h)
  if (w.rev > h.rev) {
    next = { ...next, base: w.text, rev: w.rev }
    next.local = merge(h.sent ?? h.base, h.local, w.text)
  }
  return h.later ? heard(next, h.later) : next
}

// Write `n` refused: nothing flies. What a refused spend emptied is typed
// again, since what it went into was not sent either, and nothing is written
// until the person types on.
let failed = (h: Held, n: number): Held => {
  if (h.flying != n) return h
  // Watches include the optimistic write. Its queued revision cannot prove
  // acceptance after the write failed.
  return { ...landed(h), stuck: true }
}

// A write settled: nothing in flight.
let landed = (h: Held): Held => ({
  ...h,
  flying: undefined,
  sent: undefined,
  later: undefined,
})

// Whether the store has yet to take what is typed here.
let due = (h: Held) => !h.stuck && h.flying == null && h.local != h.base
let behind = (h: Held) => h.flying != null || h.local != h.base

let STASH = 'draft:'

type Kept = { text: string; over: string; rev: number }

/** Bind a person's drafts to the graph that keeps them. */
/// let { client } = await import('@yaks/client')
/// let { loadVocab } = await import('@yaks/vocab')
/// let { draftDoc, drafts } = await import('@yaks/draft')
/// let g = client(loadVocab([draftDoc]), [drafts()], { vault: false })
/// let d = desk(g, { by: () => 'jo' })
/// d.type('search', '.task')
/// let typed = d.text('search') // at once
/// typed -> '.task'
/// d.close()
export let desk = (
  client: Client,
  opts: DeskOpts,
): Drafts & { close: () => void } => {
  let pace = opts.pace ?? 500
  let held = new Map<string, Held>()
  let shown = new Map<string, Signal<string>>()
  let timers = new Map<string, ReturnType<typeof setTimeout>>()
  // Visible text can be emptied, or replaced by more typing, while a send
  // waits. Each send keeps its own recovery copy until its answer arrives.
  let recovery = new Map<string, Map<number, string>>()
  let stashed = new Map<string, string>()
  let writes = 0
  let closed = false

  let get = (place: string) => held.get(place) ?? fresh()
  let seen = (place: string) => {
    let s = shown.get(place)
    if (!s) shown.set(place, s = signal(get(place).local))
    return s
  }

  // What is not the store's yet waits in the stash; what is, leaves it.
  let keep = (place: string, h: Held) => {
    let key = STASH + place
    try {
      let spent = [...recovery.get(place)?.values() ?? []]
      if (!behind(h) && !spent.length) return opts.stash?.removeItem(key)
      let kept: Kept = {
        text: spent.reduce((text, copy) => merge('', copy, text), h.local),
        over: spent.length ? '' : h.base,
        rev: h.rev,
      }
      let value = JSON.stringify(kept)
      opts.stash?.setItem(key, value)
      stashed.set(place, value)
    } catch (err) {
      opts.report?.(err)
    }
  }

  let hold = (place: string, h: Held) => {
    held.set(place, h)
    seen(place).value = h.local
    keep(place, h)
  }

  let step = (place: string, f: (h: Held) => Held) => {
    hold(place, f(get(place)))
    schedule(place)
  }

  let forward = (bundles: Bundle[]) => {
    if (!bundles.length) return Promise.resolve(true)
    try {
      return Promise.resolve(client.mutate(bundles)).then(() => true, (err) => {
        opts.report?.(err)
        return false
      })
    } catch (err) {
      opts.report?.(err)
      return Promise.resolve(false)
    }
  }

  // A write of what is typed, over what it was typed over, with `also`
  // beside it in one batch.
  let send = (place: string, also: Bundle[] = [], spent?: string) => {
    clearTimeout(timers.get(place))
    timers.delete(place)
    let by = opts.by()
    let h = get(place)
    let n = ++writes
    if (spent != null) {
      let copies = recovery.get(place) ?? new Map<number, string>()
      copies.set(n, spent)
      recovery.set(place, copies)
      h = { ...h, local: '', stuck: false }
    }
    let eid = by ? draftEid(by, place) : undefined
    let over = h.flying != null ? h.sent ?? h.base : h.base
    hold(place, { ...h, flying: n, sent: h.local, left: Date.now() })
    let fail = (err: unknown) => {
      opts.report?.(err)
      if (closed) return false
      let text = recovery.get(place)?.get(n)
      recovery.get(place)?.delete(n)
      step(place, (h) => ({
        ...failed(h, n),
        // Recovered sends are insertions: a newer empty watched draft must
        // never read them as text another interface deleted.
        base: text == null ? h.base : '',
        local: text == null ? h.local : merge('', text, h.local),
      }))
      return false
    }
    try {
      return Promise.resolve(client.mutate([
        ...also,
        ...eid
          ? [{
            entity: { eid },
            draft: { by, place, text: h.local },
            typed: { over },
          }]
          : [],
      ])).then((applied) => {
        let d = applied.find((b) => b.entity.eid == eid)?.draft as
          | { text?: string; rev?: number }
          | undefined
        if (eid && !d) {
          return fail(new Error('write accepted without its draft'))
        }
        // A closed desk may reconcile the copy it left, but never overwrite
        // what a replacement desk typed. Only this receipt proves its base;
        // watched optimistic text cannot stand in for acceptance.
        if (closed) {
          try {
            let copy = stashed.get(place)
            if (copy == null || opts.stash?.getItem(STASH + place) !== copy) {
              return true
            }
          } catch (error) {
            opts.report?.(error)
            return true
          }
        }
        recovery.get(place)?.delete(n)
        let accept = (next: Held) =>
          d
            ? answered(next, n, word(d))
            : next.flying == n
            ? { ...landed(next), base: '' }
            : next
        if (closed) keep(place, accept(get(place)))
        else step(place, accept)
        return true
      }, fail)
    } catch (err) {
      return Promise.resolve(fail(err))
    }
  }

  // Write a draft when the store is behind it: at once after a quiet spell,
  // else once the pace since the last write runs out. One flies at a time;
  // its answer schedules the next.
  let schedule = (place: string) => {
    let h = get(place)
    if (closed || !due(h) || timers.has(place) || !opts.by()) return
    let wait = h.left + pace - Date.now()
    if (wait <= 0) return send(place)
    timers.set(place, setTimeout(() => send(place), wait))
  }

  let word = (d: { text?: string; rev?: number }): Word => ({
    text: d.text ?? '',
    rev: d.rev ?? 0,
  })

  // What a last load typed and the store never took.
  for (let i = 0; i < (opts.stash?.length ?? 0); i++) {
    let key = opts.stash?.key(i) ?? ''
    if (!key.startsWith(STASH)) continue
    try {
      let k = JSON.parse(opts.stash?.getItem(key) ?? '') as Kept
      held.set(key.slice(STASH.length), {
        base: k.over,
        rev: k.rev,
        local: k.text,
        left: 0,
      })
    } catch { /* an item this build cannot read: the store has the rest */ }
  }

  // Once it is known whose they are: the store's drafts heard as they
  // change, and whatever is behind them written.
  let stop = effect(() => {
    let by = opts.by()
    if (!by) return
    return untracked(() => {
      let watch = client.watch(`.draft.by=${by}`)
      let hear = (rows: Bundle[]) =>
        batch(() => {
          for (let b of rows) {
            let d = b.draft as { place?: string; text?: string; rev?: number }
            if (d?.place) step(d.place, (h) => heard(h, word(d)))
          }
        })
      hear(watch.value)
      let off = watch.subscribe(hear)
      for (let place of held.keys()) schedule(place)
      return () => {
        off()
        watch.close?.()
      }
    })
  })

  return {
    text: (place) => seen(place).value,
    type: (place, text) =>
      step(place, (h) => ({ ...h, local: text, stuck: false })),
    spend: (place, also = []) => {
      let h = get(place)
      if (!behind(h) && !h.local) {
        return forward(also)
      }
      return send(place, also, h.local)
    },
    restore: (place, text, over = '') =>
      step(place, (h) => ({
        ...h,
        local: merge(over, text, h.local),
        stuck: false,
      })),
    close: () => {
      closed = true
      stop()
      for (let t of timers.values()) clearTimeout(t)
      timers.clear()
    },
  }
}
