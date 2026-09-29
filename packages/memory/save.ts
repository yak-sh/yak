// Writing one down. A memory is a mark on the entity holding what somebody
// said: {@link marked} puts it on an entity that already holds the words (a
// session entry, a comment, a doc), and {@link saved} makes a doc to hold words
// the graph has nowhere yet. Neither edits words that are already there.
//
// Two rules live here, and both are about keeping the person's words the
// person's words.
//
// An empty `said` is rejected. A memory with no sentence in it is an agent's
// note about a conversation, which is the thing this whole package exists to
// not be.
//
// The context is truncated to two lines. Context is what somebody needs in order
// to read the sentence — what was being talked about, which app, which
// afternoon — and left unbounded it grows into the summary the sentence was
// saved instead of. Two lines is enough to say "we were looking at the recipe
// app" and not enough to restate what was said.

import { type Bundle, type Eid, Refused } from '@yaks/graph'
import { MEMORY } from './comp.ts'

/** The most context a memory carries, in lines. */
export let LINES = 2

/** Why a save was rejected, worded so an agent can fix it. */
export let EMPTY =
  'said: the words the person used, as they used them — a memory is their ' +
  'sentence, never your summary of it'

/**
 * The context, truncated: blank lines dropped, each line trimmed,
 * {@link LINES} kept.
 *
 * ```ts
 * clamped('  we were looking at\n\nthe recipe app\nand also this\nand this')
 * // 'we were looking at\nthe recipe app'
 * ```
 */
export let clamped = (context: string): string =>
  context.split('\n').map((l) => l.trim()).filter(Boolean)
    .slice(0, LINES).join('\n')

/** What a caller hands over to mark words the graph already holds. All of it
 * but the entity is about where the words belong: a graph with no spaces in it
 * keeps memories all the same. */
export type Marking = {
  /** the entity holding the words */
  eid: Eid
  /** the space they belong to */
  space?: Eid
  /** the project they belong to — absent for a principle everybody carries */
  scope?: Eid
  /** who gave the correction, when the words are one; `true` where they are
   * feedback and nobody knows whose */
  feedback?: Eid | true
  /** the line or two needed to read them */
  context?: string
  /** the app they were about, by slug */
  about?: string
}

/** What a caller hands over to keep words the graph holds nowhere yet. */
export type Saving = Marking & {
  /** the person's own words, verbatim */
  said: string
  /** the index line a recall shows first, where somebody gave one */
  title?: string
}

/** The component marking a memory as a correction somebody gave. */
export let FEEDBACK = 'feedback'

/**
 * A mark on an entity that already holds the words, as the list of changes
 * that writes it: `memory` and, for a correction, `feedback`, and nothing
 * about the words themselves. Who marked it, and when, the graph stamps.
 *
 * ```ts
 * marked({ eid: 'e1', context: 'looking at the recipe app' })
 * // [{ entity: { eid: 'e1' },
 * //    memory: { context: 'looking at the recipe app' } }]
 * ```
 */
export let marked = (m: Marking): Bundle[] => {
  let context = clamped(m.context ?? '')
  let about = (m.about ?? '').trim()
  return [{
    entity: { eid: m.eid },
    [MEMORY]: {
      ...(m.space ? { space: m.space } : {}),
      ...(m.scope ? { scope: m.scope } : {}),
      ...(context ? { context } : {}),
      ...(about ? { about } : {}),
    },
    ...(m.feedback
      ? { [FEEDBACK]: m.feedback === true ? {} : { by: m.feedback } }
      : {}),
  }]
}

/**
 * Words the graph holds nowhere yet, as the list of changes that keeps them:
 * a doc whose body is the words exactly as they were said, marked. The byline
 * is stamped by the graph, so nothing here writes one.
 */
export let saved = (m: Saving): Bundle[] => {
  let said = m.said.trim()
  if (!said) throw new Refused(EMPTY)
  let title = (m.title ?? '').trim()
  let [mark] = marked(m)
  return [{ ...mark, doc: { ...(title ? { title } : {}), body: said } }]
}
