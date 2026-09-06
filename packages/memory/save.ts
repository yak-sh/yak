// Writing one down. Two rules live here, and both are about keeping the
// person's words the person's words.
//
// AN EMPTY `said` IS REFUSED. A memory with no sentence in it is an agent's
// note about a conversation, which is the thing this whole package exists to
// not be.
//
// THE CONTEXT IS CLAMPED to two lines. Context is what somebody needs in order
// to read the sentence — what was being talked about, which app, which
// afternoon — and left unbounded it grows into the summary the sentence was
// saved instead of. Two lines is enough to say "we were looking at the recipe
// app" and not enough to restate what was said.

import type { Bundle, Eid } from '@yaks/graph'
import { MEMORY } from './comp.ts'

/** The most context a memory carries, in lines. */
export let LINES = 2

/** What a save is refused for, said so an agent can fix it. */
export let EMPTY =
  'said: the words the person used, as they used them — a memory is their ' +
  'sentence, never your summary of it'

/**
 * The context, clamped: blank lines dropped, each line trimmed, {@link LINES}
 * kept.
 *
 * ```ts
 * clamped('  we were looking at\n\nthe recipe app\nand also this\nand this')
 * // 'we were looking at\nthe recipe app'
 * ```
 */
export let clamped = (context: string): string =>
  context.split('\n').map((l) => l.trim()).filter(Boolean)
    .slice(0, LINES).join('\n')

/** What a caller hands over to keep one. */
export type Saving = {
  /** the id to write it at */
  eid: Eid
  /** the person's own words, verbatim */
  said: string
  /** the space they belong to */
  space: Eid
  /** the line or two needed to read them */
  context?: string
  /** the app they were about, by slug */
  about?: string
}

/**
 * One memory as the batch that writes it: the words in `doc.body` exactly as
 * they were said, everything else in `memory`. The byline is the graph's own
 * stamp, so nothing here writes one.
 */
export let saved = (m: Saving): Bundle[] => {
  let said = m.said.trim()
  if (!said) throw new Error(EMPTY)
  let context = clamped(m.context ?? '')
  let about = (m.about ?? '').trim()
  return [{
    entity: { eid: m.eid },
    doc: { body: said },
    [MEMORY]: {
      space: m.space,
      ...(context ? { context } : {}),
      ...(about ? { about } : {}),
    },
  }]
}
