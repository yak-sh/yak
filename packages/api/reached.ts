// Subscriptions over graphs this host can ask but not watch: the members of a
// reach (@yaks/reach), several graphs answering as one. No member's commit
// passes through here as a transaction the registry could route, so a member
// feeding news says only that something moved: every query is asked again,
// whole, and its answer is sent when it moved. Like a tide table read again
// whenever any harbour reports, rather than a harbour's own log.
//
// It speaks the frames `subscriptions` speaks and a socket serves it the same
// way (./socket.ts `attach`): `{subscribe: line}` is answered whole, with
// `reset`, and again after each change that moved it; `{subscribe: true}` is
// the raw feed, the first member's own frames as it sent them; a relayed value
// goes where the host sends it, which is the member that holds its words.
// {@link beside} puts it next to a graph's own registry, so one socket asks
// each line of whichever answers it.

import type { Bundle, ReadOpts, Reduced } from '@yaks/graph'
import { after } from '@yaks/fp'
import { fault, refusal, type Tags } from './refuse.ts'
import type { Ask, Frame, Listening, Opening, Sink, Subs } from './subs.ts'

/** A registry over a reach, as {@link reached} makes one. */
export type Reached = Listening & {
  /** A member's feed spoke: every query is asked again, settled when each
   * answer is. A frame of the first member's (`own`) is also the raw feed's,
   * sent on as it came. */
  hear: (frame?: Frame, own?: boolean) => Promise<void>
  /** Reopen saved watches. With `quiet`, each is held and not asked until
   * {@link Reached.resume} or the next {@link Reached.hear}: a page that
   * kept its answers through its host's sleep is not sent them again. */
  restore: (openings: Opening[], quiet?: boolean) => void
  /** Ask every watch held quiet. */
  resume: () => void
  /** Whether any line is watched. */
  watching: () => boolean
}

type Watch = { ask: Ask; asked: number; opts?: ReadOpts; said?: string }

/**
 * Subscriptions answered by `read`, the reach's one answer to a line, and
 * asked again on each {@link Reached.hear}. A refusal is sent under its id
 * and the subscription stays open: the next change asks again, and a member
 * that came back answers.
 *
 * ```ts
 * import { reached } from '@yaks/api/reached'
 * import { equal, until } from '@yaks/testing'
 *
 * let books = [{ entity: { eid: 'dune' }, book: {} }]
 * let subs = reached({ read: () => Promise.resolve(books) })
 * let frames: unknown[] = []
 * subs.open((f) => frames.push(f), 'all', '.book')
 * await until(() => frames.length == 1)
 * books = [...books, { entity: { eid: 'emma' }, book: {} }]
 * subs.hear({ id: 'feed', bundles: [] })
 * await until(() => frames.length == 2)
 * equal(frames[1], { id: 'all', bundles: books, reset: true })
 * ```
 */
export let reached = (opts: {
  /** the reach's answer to a line, asked as the watch's opener: its
   * bundles, or a reduction */
  read: (line: string, opts?: ReadOpts) => Promise<Bundle[] | Reduced>
  /** where a relayed value goes */
  relay?: (bundles: Bundle[]) => void
  /** told of every answer refused, with its line, for a host that knows
   * whose line it was */
  refused?: (error: unknown, line: string) => void
  /** what a failure reported here is tagged with (./refuse.ts `fault`) */
  tags?: Tags
}): Reached => {
  let held = new Map<Sink, Map<string, Watch>>()
  // A newer ask, a replacement or a close makes an answer still on its way
  // nobody's.
  let ask = (sink: Sink, id: string, watch: Watch) => {
    let line = watch.ask
    if (line === true) return
    let asked = ++watch.asked
    let current = () =>
      held.get(sink)?.get(id) === watch && watch.asked == asked
    return opts.read(line, watch.opts).then((answer) => {
      if (!current()) return
      let frame: Frame = Array.isArray(answer)
        ? { id, bundles: answer, reset: true }
        : { id, ...answer }
      let said = JSON.stringify(frame)
      if (said == watch.said) return
      watch.said = said
      sink(frame)
    }, (error) => {
      if (!current()) return
      watch.said = undefined
      fault(error, 'reached subscription', opts.tags)
      opts.refused?.(error, line)
      sink({ id, refused: refusal(error) })
    })
  }
  // Held, and asked unless `quiet`.
  let open = (
    sink: Sink,
    id: string,
    query: Ask,
    read?: ReadOpts,
    quiet = false,
  ) => {
    let mine = held.get(sink) ?? new Map<string, Watch>()
    held.set(sink, mine)
    let watch: Watch = { ask: query, asked: 0, opts: read }
    mine.set(id, watch)
    if (!quiet) return ask(sink, id, watch)
  }
  return {
    open: (sink, id, query, read) => open(sink, id, query, read),
    restore: (openings, quiet) => {
      for (let { sink, id, query, opts: read } of openings) {
        open(sink, id, query, read, quiet)
      }
    },
    resume: () => {
      for (let [sink, mine] of held) {
        for (let [id, watch] of mine) {
          if (!watch.asked) ask(sink, id, watch)
        }
      }
    },
    watching: () =>
      [...held.values()].some((mine) =>
        [...mine.values()].some((w) => w.ask !== true)
      ),
    close: (sink, id) => {
      held.get(sink)?.delete(id)
    },
    drop: (sink) => {
      held.delete(sink)
    },
    relay: (_sink, bundles) => opts.relay?.(bundles),
    hear: async (frame, own = false) => {
      let asked: Promise<void>[] = []
      for (let [sink, mine] of held) {
        for (let [id, watch] of mine) {
          if (watch.ask !== true) asked.push(ask(sink, id, watch)!)
          else if (own && frame) sink({ ...frame, id })
        }
      }
      await Promise.all(asked)
    },
  }
}

/**
 * One registry of two: the lines `borrows` names asked of `lent`, and every
 * other subscription (its own lines, the raw feed) and every relayed value
 * of `subs`, so a host's socket serves both as one ({@link Subs}). A watch
 * replaced by a line the other answers moves to it.
 *
 * ```ts
 * import { reached, beside } from '@yaks/api/reached'
 * import { subscriptions } from '@yaks/api'
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { loadVocab } from '@yaks/vocab'
 * import { equal, until } from '@yaks/testing'
 *
 * let vocab = loadVocab({ $defs: { book: { component: true, type: 'object' } } })
 * let own = subscriptions(graph({ vocab, storage: ram(vocab) }))
 * let lent = reached({
 *   read: () => Promise.resolve([{ entity: { eid: 'loan' }, loan: {} }]),
 * })
 * let both = beside(own, lent, (line) => line.includes('loan'))
 * let frames: unknown[] = []
 * both.open((f) => frames.push(f), 'loans', '.loan')
 * await until(() => frames.length == 1)
 * equal(lent.watching(), true)
 * ```
 */
export let beside = (
  subs: Subs,
  lent: Reached,
  borrows: (line: string) => boolean,
): Subs => {
  let theirs = (query: Ask) => query !== true && borrows(query)
  // Which of a sink's watches the lent registry holds, so a close goes to
  // the one holding it and a replacement leaves the other.
  let away = new Map<Sink, Set<string>>()
  let lend = (sink: Sink, id: string, yes: boolean) => {
    let ids = away.get(sink) ?? new Set<string>()
    away.set(sink, ids)
    let was = ids.has(id)
    if (yes) ids.add(id)
    else ids.delete(id)
    return was
  }
  return {
    ...subs,
    open: (sink, id, query, opts) => {
      let was = lend(sink, id, theirs(query))
      if (theirs(query)) {
        return after(
          was ? undefined : subs.close(sink, id),
          () => lent.open(sink, id, query, opts),
        )
      }
      if (was) lent.close(sink, id)
      return subs.open(sink, id, query, opts)
    },
    restore: (openings, deferStatic) => {
      for (let o of openings) lend(o.sink, o.id, theirs(o.query))
      lent.restore(openings.filter((o) => theirs(o.query)), deferStatic)
      return subs.restore(
        openings.filter((o) => !theirs(o.query)),
        deferStatic,
      )
    },
    resume: () => {
      lent.resume()
      return subs.resume?.()
    },
    close: (sink, id) => {
      if (lend(sink, id, false)) return lent.close(sink, id)
      return subs.close(sink, id)
    },
    drop: (sink) => {
      away.delete(sink)
      lent.drop(sink)
      return subs.drop(sink)
    },
  }
}
