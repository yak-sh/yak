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

import type { Bundle, Reduced } from '@yaks/graph'
import { fault, refusal, type Tags } from './refuse.ts'
import type { Ask, Frame, Listening, Sink } from './subs.ts'

/** A registry over a reach, as {@link reached} makes one. */
export type Reached = Listening & {
  /** A member's feed spoke: every query is asked again. A frame of the first
   * member's (`own`) is also the raw feed's, sent on as it came. */
  hear: (frame: Frame, own?: boolean) => void
}

type Watch = { ask: Ask; asked: number; said?: string }

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
  /** the reach's answer to a line: its bundles, or a reduction */
  read: (line: string) => Promise<Bundle[] | Reduced>
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
    return opts.read(line).then((answer) => {
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
  return {
    open: (sink, id, query) => {
      let mine = held.get(sink) ?? new Map<string, Watch>()
      held.set(sink, mine)
      let watch: Watch = { ask: query, asked: 0 }
      mine.set(id, watch)
      return ask(sink, id, watch)
    },
    close: (sink, id) => {
      held.get(sink)?.delete(id)
    },
    drop: (sink) => {
      held.delete(sink)
    },
    relay: (_sink, bundles) => opts.relay?.(bundles),
    hear: (frame, own = false) => {
      for (let [sink, mine] of held) {
        for (let [id, watch] of mine) {
          if (watch.ask !== true) ask(sink, id, watch)
          else if (own) sink({ ...frame, id })
        }
      }
    },
  }
}
