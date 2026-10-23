/**
 * Words that match what was sought, marked where they stand: in a title, a
 * passage, a line of a list. `marked(text)` marks each run of `text` set
 * between `\x01` and `\x02`, the marks @yaks/fts and @yaks/graph/hit cut a
 * snippet with.
 *
 * ```ts
 * import { h } from 'preact'
 * import { renderToString } from 'preact-render-to-string'
 * import { marked } from './Match.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal(
 *   renderToString(h('span', null, marked('often \x01miles\x02 long'))),
 *   '<span>often <mark class="Match">miles</mark> long</span>',
 * )
 * equal(marked('no match'), ['no match'])
 * ```
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { type ComponentChild, h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A match. */
export let Match: Part = el('mark', 'Match')

/** `text` with each run between `\x01` and `\x02` a {@link Match}. */
export let marked = (text: string): ComponentChild[] =>
  text.split('\x01').flatMap((chunk, i) => {
    if (!i) return chunk ? [chunk] : []
    let [found, rest = ''] = chunk.split('\x02')
    return [h(Match, { key: i }, found), ...rest ? [rest] : []]
  })

/** What it is, in a line. */
export let description = 'Words that match what was sought, marked in place.'

/** A match is the accent, and bold where a terminal has no wash. */
export let sheet = (c: Colors): Sheet => ({
  Match: { fg: c.accent, bold: true },
})

/** A match in a line. */
export let specimens = (): Specimen[] => [
  [
    'Match',
    h('span', {}, marked('the result list is \x01good\x02 and meaningful')),
  ],
]
