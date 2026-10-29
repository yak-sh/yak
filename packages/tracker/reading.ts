// How a bug and an error read, whatever draws them: the whole message, where
// it happened, whether it is still broken, and the queries a page asks.
import type { Bundle } from '@yaks/graph'
import { type And, and, eq, every, order, querySearch } from '@yaks/query'
import { comp, type Frame, str, title } from './model.ts'
import { place, spot } from './brief.ts'

/** Worst first is historical occurrence count, not the retained sample size. */
export let openBugs = '.bug.status=open * .order=-bug.hits'
/** A bug's retained occurrences, newest first, as the query line a page asks. */
export let occurrences = (eid: string): string =>
  `.error.bug=${eid} * .order=-error.at`
/** The same occurrences as a tree, for a read that need not parse a line that
 * changes with every bug.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { parse } from '@yaks/query'
 * equal(occurring('b'), parse(occurrences('b')))
 * ```
 */
export let occurring = (eid: string): And =>
  and(eq('error.bug', eid), every(), order('-error.at'))

/** A bug's page on the box's tracker web when it lives on another side (the
 * platform tracker, `yaks.app`), read through by global eid; one of its
 * occurrences opens on the same page.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   remoteBug('yaks.app', 'b', 'e'),
 *   '/?.bug&side=yaks.app&bug=b&error=e',
 * )
 * ```
 */
export let remoteBug = (side: string, bug: string, error?: string): string =>
  `/${
    querySearch('.bug', {
      side,
      bug,
      ...error ? { error } : {},
    })
  }`

/** The whole message a bug or an error says. */
export let said = (e: Bundle): string =>
  e.bug ? str(comp(e, 'doc').title) : title(e)

/** Where a bug is open, resolved or archived; regressed is open again. */
export let standing = (e: Bundle): string =>
  str(comp(e, 'bug').status) ||
  (e.archived ? 'archived' : e.resolved ? 'resolved' : 'open')

/** The dot a bug's standing wears: what is broken is a negative disc. */
export let pip = (e: Bundle): string[] =>
  ({
    open: e.regressed ? ['alert', 'negative'] : ['negative'],
    resolved: ['check', 'positive'],
    archived: ['ring'],
  })[standing(e)] ?? ['ring']

/** Where a bug happens, briefly: its spot, or the culprit's frame in the
 * newest occurrence when the culprit names code this store does not hold. */
export let where = (e: Bundle, newest?: Bundle): string => {
  let bug = comp(e, 'bug')
  if (bug.spot) {
    let s = spot(str(bug.spot))
    return [s.place, s.fn].filter(Boolean).join(' · ')
  }
  let frames = (comp(newest, 'exception').frames ?? []) as Frame[]
  let f = frames.find((f) => f.symbol && f.symbol == bug.culprit) ??
    frames.find((f) => f.app) ?? frames[0]
  return f ? frameAt(f) : ''
}

/** A frame's place and line, and what ran there. */
export let frameAt = (f: Frame): string =>
  [
    place(f.file) + (f.line ? `:${f.line}` : ''),
    f.function,
  ].filter(Boolean).join(' · ')

/** Request identity is an exact association. Other context is a bounded time
 * neighbour, not evidence that a trace contains or caused this error. */
export let relatedTraces = (
  e: Bundle,
): { query: string; label: string } | undefined => {
  let during = comp(e, 'during'), at = Date.parse(str(comp(e, 'error').at))
  let quote = (v: unknown) => JSON.stringify(str(v))
  if (during.request) {
    return {
      query: `.trace .during.request=${
        quote(during.request)
      } * .order=-trace.at`,
      label: 'Traces of the same request',
    }
  }
  let key = during.entity ? 'entity' : during.process ? 'process' : undefined
  if (!key || !Number.isFinite(at)) return
  let scopes = ['space', 'app'].filter((k) => during[k])
    .map((k) => `.during.${k}=${quote(during[k])}`).join(' ')
  return {
    query: `.trace .during.${key}=${quote(during[key])} ${scopes} .trace.at>=${
      quote(new Date(at - 300_000).toISOString())
    } .trace.at<=${
      quote(new Date(at + 300_000).toISOString())
    } * .order=-trace.at`,
    label: `Traces within 5 minutes in the same ${
      key == 'entity' ? 'store or context' : 'process'
    }, nearby rather than causal`,
  }
}
