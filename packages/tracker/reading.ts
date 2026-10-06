// How a bug and an error read, whatever draws them: the whole message, where
// it happened, whether it is still broken, and the queries a page asks.
import type { Bundle } from '@yaks/graph'
import { comp, type Frame, str, title } from './model.ts'
import { place, spot } from './brief.ts'

/** Worst first is historical occurrence count, not the retained sample size. */
export let openBugs = '.bug.status=open * .order=-bug.hits'
export let occurrences = (eid: string): string =>
  `.error.bug=${eid} * .order=-error.at`

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
