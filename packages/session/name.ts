// What a session is called wherever one is named: by what it works on. Its
// handle (`#5b8062c912`) says nothing to a person, and the command that
// launched it (`claude -p --session-id … --append-system-prompt …`) carries a
// whole persona and brief, so neither is ever its name.
//
// The name is found in one place, here, from the session's own row and three
// bounded reads (`asks`): the task it holds, the task it worked (its title read
// across the `worked` edge), and its opening entries. Every door draws it through the session's portable `Title`
// (./lines.ts) or its inspector tile (./inspect.ts); naming a session never
// loads its transcript.

import type { Bundle } from '@yaks/graph'
import { SESSION } from './comp.ts'
import { ENTRY } from './native.ts'

/** The rows a session's name is found from, each answering its query in
 * {@link asks}: the task it holds, the `worked` edge and the task it worked,
 * and its opening entries. Any may be missing; the name is found from what is
 * there. */
export type Read = { claim?: Bundle[]; work?: Bundle[]; first?: Bundle[] }

/** The bounded reads a session's name is found from, by what {@link Read}
 * holds each answer under. */
export let asks = (eid: string): Record<keyof Read, string> => ({
  claim: `.claim.session=${eid}&.fields=doc.title&.limit=1`,
  work: `.worked&.edge.from=${eid}&.fields=edge.to.doc.title&.limit=1`,
  first: `.${ENTRY}.session=${eid}&.order=${ENTRY}.seq&.limit=12` +
    '&?content&?output&?notice&?prompt&?call&?result&?reasoning&?stop' +
    '&?exception&?refusal&?ask&?interrupted&?using&?lines',
})

/** How long a name drawn from words runs before it is cut. */
export let LONG = 180

type Comp = Record<string, unknown>
let str = (b: Bundle | undefined, comp: string, prop: string): string => {
  let v = (b?.[comp] as Comp | undefined)?.[prop]
  return typeof v == 'string' ? v : ''
}

let cut = (text: string, n: number) =>
  text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text

// An entry that is somebody's prose, rather than a model's reply, a tool's
// call or answer, or the bookkeeping of a turn.
let prose = (b: Bundle) =>
  b.content && !b.output && !b.call && !b.result && !b.reasoning &&
  !b.prompt && !b.stop && !b.ask && !b.exception && !b.refusal &&
  !b.interrupted

/** What a session's opening words are: the first a person said, else the
 * instruction it was started with (a child's starts as a notice). */
export let firstWords = (read: Read): string => {
  let said = (read.first ?? []).filter(prose)
  return str(said.find((b) => !b.notice) ?? said[0], 'content', 'body')
}

/**
 * What a session is called: the title of the task it holds or worked, its own
 * title, its opening words or brief cut to {@link LONG}, or, for the
 * owner's own conversation, `Personal conversation`. Empty when it has none of
 * these: the caller names it by its id.
 *
 * ```ts
 * import { sessionName } from './name.ts'
 * import { equal } from '@yaks/testing'
 *
 * let s = { entity: { eid: 's1' }, session: { id: 's1' } }
 * let task = { entity: { eid: 't1' }, doc: { title: 'Fix the cake' } }
 * equal(sessionName(s, { claim: [task] }), 'Fix the cake')
 * let words = { entity: { eid: 'e1' }, content: { body: 'hello  there' } }
 * equal(sessionName(s, { first: [words] }), 'hello there')
 * equal(sessionName(s, {}), '')
 * ```
 */
export let sessionName = (e: Bundle, read: Read): string =>
  str(read.claim?.[0], 'doc', 'title') ||
  str(read.work?.find((b) => b.doc), 'doc', 'title') ||
  str(e, 'doc', 'title') ||
  cut(
    (firstWords(read) || str(e, 'brief', 'text')).trim().replace(/\s+/g, ' '),
    LONG,
  ) ||
  ((e[SESSION] as Comp | undefined)?.operator ? 'Personal conversation' : '')
