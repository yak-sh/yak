// Subscriptions over graphs this host can ask but not watch: the members of a
// reach (@yaks/reach), several graphs answering as one. No member's commit
// passes through here as a transaction the registry could route, so a member
// feeding news says only that something moved: every line is asked again,
// whole, and its answer is sent when it moved. Like a tide table read again
// whenever any harbour reports, rather than a harbour's own log.
//
// A line is answered in the frames `subscriptions` speaks: whole, with
// `reset`, and again after each change that moved it. {@link beside} puts it
// next to a graph's own registry, which keeps the raw feed and relayed
// values, so one socket asks each line of whichever answers it.

import type { Bundle, Graph, ReadOpts, Reduced } from '@yaks/graph'
import { after, type Clock, system } from '@yaks/fp'
import { fault, refusal, type Tags } from './refuse.ts'
import type { Ask, Frame, Listening, Opening, Sink, Subs } from './subs.ts'
import type { PeerWriter } from './save.ts'

/** A registry over a reach, as {@link reached} makes one. */
export type Reached = {
  /** Watch a line as `opts` and `writer` say who asks, and send its
   * answer. */
  open: (
    sink: Sink,
    id: string,
    line: string,
    opts?: ReadOpts,
    writer?: PeerWriter,
  ) => void
  /** Reopen saved watches. With `quiet`, each is held and not asked until
   * {@link Reached.resume} or the next {@link Reached.hear}: a page that
   * kept its answers through its host's sleep is not sent them again. */
  restore: (openings: Opening[], quiet?: boolean) => void | Promise<void>
  /** Ask every watch held quiet. */
  resume: () => void | Promise<void>
  close: (sink: Sink, id: string) => void
  drop: (sink: Sink) => void
  /** A member's graph moved: every line `only` names (every line, without
   * it) is asked again, settled when each answer is. */
  hear: (only?: (line: string) => boolean) => Promise<void>
  /** Whether any line is watched. */
  watching: () => boolean
}

type Watch = {
  line: string
  asked: number
  opts?: ReadOpts
  writer?: PeerWriter
  said?: string
  cancel?: () => void
  revision?: number
}

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
 * await subs.hear()
 * equal(frames[1], { id: 'all', bundles: books, reset: true })
 * ```
 */
export let reached = (opts: {
  /** the reach's answer to a line, asked as the watch's opener (the read it
   * asks as, and its writer, whom a host vouches to the members): its
   * bundles, or a reduction */
  read: (
    line: string,
    opts?: ReadOpts,
    writer?: PeerWriter,
  ) => Promise<Bundle[] | Reduced>
  /** told of every answer refused, with its line, for a host that knows
   * whose line it was */
  refused?: (error: unknown, line: string) => void
  /** what a failure reported here is tagged with (./refuse.ts `fault`) */
  tags?: Tags
  /** When a time-dependent answer next changes without a write. */
  renew?: (answer: Bundle[] | Reduced) => number | undefined
  /** Schedule a renewal at an absolute time. Defaults to the clock's timer. */
  renewAt?: (at: number, read: () => Promise<void>) => () => void
  clock?: Clock
  /** The local revision at which a derived read starts. */
  revision?: () => number
}): Reached => {
  let held = new Map<Sink, Map<string, Watch>>()
  let clock = opts.clock ?? system
  // A newer ask, a replacement or a close makes an answer still on its way
  // nobody's.
  let ask = (sink: Sink, id: string, watch: Watch): Promise<void> => {
    watch.cancel?.()
    let asked = ++watch.asked
    let revision = opts.revision?.()
    let current = () =>
      held.get(sink)?.get(id) === watch && watch.asked == asked
    return opts.read(watch.line, watch.opts, watch.writer).then((answer) => {
      if (!current()) return
      let next = opts.renew?.(answer)
      if (next !== undefined) {
        let read = () => ask(sink, id, watch)
        let now = clock.now()
        watch.cancel = opts.renewAt
          ? opts.renewAt(Math.max(now + 1, next), read)
          : clock.after(Math.min(2 ** 31 - 1, Math.max(1, next - now)), read)
      }
      let frame: Frame = Array.isArray(answer)
        ? { id, bundles: answer, reset: true }
        : { id, ...answer }
      let said = JSON.stringify(frame)
      if (said == watch.said) return
      watch.said = said
      if (revision !== undefined) {
        frame.revision = revision
        frame.since = watch.revision
        watch.revision = revision
      }
      sink(frame)
    }, (error) => {
      if (!current()) return
      watch.said = undefined
      fault(error, 'reached subscription', opts.tags)
      opts.refused?.(error, watch.line)
      sink({ id, refused: refusal(error) })
    })
  }
  // Held, and asked unless `quiet`.
  let open = (
    sink: Sink,
    id: string,
    line: string,
    read?: ReadOpts,
    writer?: PeerWriter,
    quiet = false,
  ) => {
    let mine = held.get(sink) ?? new Map<string, Watch>()
    held.set(sink, mine)
    mine.get(id)?.cancel?.()
    let watch: Watch = { line, asked: 0, opts: read, writer }
    mine.set(id, watch)
    if (!quiet) {
      let asked = ask(sink, id, watch)
      if (opts.renewAt) return asked
    }
  }
  let joined = (work: Promise<void>[]) =>
    work.length ? Promise.all(work).then(() => {}) : undefined
  return {
    open: (sink, id, line, read, writer) => {
      // The subscription is registered before its read settles, so a later
      // unsubscribe can remove it from the socket attachment immediately.
      void open(sink, id, line, read, writer)
    },
    restore: (openings, quiet) => {
      let work: Promise<void>[] = []
      for (let { sink, id, query, opts: read, writer } of openings) {
        if (query === true) continue
        let asked = open(sink, id, query, read, writer, quiet)
        if (asked) work.push(asked)
      }
      return joined(work)
    },
    resume: () => {
      let work: Promise<void>[] = []
      for (let [sink, mine] of held) {
        for (let [id, watch] of mine) {
          if (watch.asked) continue
          let asked = ask(sink, id, watch)
          if (opts.renewAt) work.push(asked)
        }
      }
      return joined(work)
    },
    watching: () => [...held.values()].some((mine) => mine.size > 0),
    close: (sink, id) => {
      let mine = held.get(sink)
      mine?.get(id)?.cancel?.()
      mine?.delete(id)
      if (!mine?.size) held.delete(sink)
    },
    drop: (sink) => {
      for (let watch of held.get(sink)?.values() ?? []) watch.cancel?.()
      held.delete(sink)
    },
    hear: async (only) => {
      let asked: Promise<void>[] = []
      for (let [sink, mine] of held) {
        for (let [id, watch] of mine) {
          if (!only || only(watch.line)) asked.push(ask(sink, id, watch))
        }
      }
      await Promise.all(asked)
    },
  }
}

/** A derived read that changes with committed inputs in a local graph: each
 * commit asks again the lines `affects` says it moves. */
export let computed = (
  graph: Graph,
  opts: Parameters<typeof reached>[0] & {
    affects: (bundles: Bundle[], line: string) => boolean
    hold?: (work: Promise<void>) => void
  },
): Reached => {
  let clock = opts.clock ?? system
  let revision = clock.now()
  let queries = reached({
    ...opts,
    clock,
    revision: () => revision = Math.max(revision + 1, clock.now()),
  })
  graph.use({
    name: '@yaks/api/computed',
    hooks: {
      effect: (bundles) => {
        if (queries.watching()) {
          let work = queries.hear((line) => opts.affects(bundles, line))
            .catch((e) => fault(e, 'computed subscription', opts.tags))
          opts.hold?.(work)
        }
        return bundles
      },
    },
  })
  return queries
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
  let theirs = (query: Ask): query is string => query !== true && borrows(query)
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
    open: (sink, id, query, opts, writer) => {
      let was = lend(sink, id, theirs(query))
      if (theirs(query)) {
        return after(
          was ? undefined : subs.close(sink, id),
          () => lent.open(sink, id, query, opts, writer),
        )
      }
      if (was) lent.close(sink, id)
      return subs.open(sink, id, query, opts, writer)
    },
    restore: (openings, deferStatic) => {
      for (let o of openings) lend(o.sink, o.id, theirs(o.query))
      return after(
        lent.restore(openings.filter((o) => theirs(o.query)), deferStatic),
        () =>
          subs.restore(openings.filter((o) => !theirs(o.query)), deferStatic),
      )
    },
    resume: () => after(lent.resume(), () => subs.resume?.()),
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

/** A frame a kept watch sends, before it is said under a subscription's id:
 * its `refused` is the error itself. */
export type Kept = Omit<Frame, 'id' | 'refused'> & { refused?: unknown }

/**
 * Subscriptions whose every line is a live watch another keeps, such as a
 * reach's (@yaks/reach `watch`): what it sends goes out under the
 * subscription's id, and closing the subscription stops it. It answers lines
 * only, so the raw feed is refused and relayed values go nowhere.
 *
 * ```ts
 * import { watched } from '@yaks/api/reached'
 * import { equal } from '@yaks/testing'
 *
 * let stopped = 0
 * let subs = watched({
 *   watch: (line, sink) => {
 *     sink({ bundles: [{ entity: { eid: line } }], reset: true })
 *     return () => stopped++
 *   },
 * })
 * let frames: unknown[] = []
 * let to = (f: unknown) => void frames.push(f)
 * subs.open(to, 'a', 'dune')
 * subs.drop(to)
 * equal(frames, [{ id: 'a', bundles: [{ entity: { eid: 'dune' } }], reset: true }])
 * equal(stopped, 1)
 * ```
 */
export let watched = (opts: {
  /** watch a line as `read` says who asks; returns what stops it */
  watch: (
    line: string,
    sink: (frame: Kept) => void,
    read?: ReadOpts,
  ) => () => void
  /** what a failure reported here is tagged with (./refuse.ts `fault`) */
  tags?: Tags
}): Listening => {
  let held = new Map<Sink, Map<string, () => void>>()
  let close = (sink: Sink, id: string) => {
    held.get(sink)?.get(id)?.()
    held.get(sink)?.delete(id)
  }
  return {
    open: (sink, id, query, read) => {
      if (query === true) throw new Error('a watch answers lines, not a feed')
      close(sink, id)
      let mine = held.get(sink) ?? new Map<string, () => void>()
      held.set(sink, mine)
      let live = true
      let stop = opts.watch(query, (frame) => {
        if (!live) return
        if (!('refused' in frame)) return sink({ id, ...frame } as Frame)
        fault(frame.refused, 'watched subscription', opts.tags)
        sink({ id, refused: refusal(frame.refused) })
      }, read)
      mine.set(id, () => {
        live = false
        stop()
      })
    },
    close,
    drop: (sink) => {
      for (let id of [...held.get(sink)?.keys() ?? []]) close(sink, id)
      held.delete(sink)
    },
    relay: () => {},
  }
}
