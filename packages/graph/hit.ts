// What a row a search found says of itself in one line: its kind, its title,
// and a snippet of its text around the words that found it, each match marked
// `\x01`…`\x02` as @yaks/fts marks one. The `search` tool answers this `hit`
// alone; `graph_query` paints it on the whole rows a search answers, so a
// model reads one line a row (@yaks/tools `worded`) while `--json` and
// structured content keep every component.
import type { Bundle, Comp } from './bundle.ts'
import type { Vocab } from '@yaks/vocab'

/** A search row's line: what it is, what it is called, the words around the
 * match, and that words found it. */
export type Hit = {
  kind: string
  title: string
  snippet: string
  source: 'text'
}

// How much of a text a snippet keeps before and after its first match.
let BEFORE = 60
let AFTER = 140

/** The title a row is known by: the first `title` any of its components
 * holds, or ''. */
export let titleOf = (b: Bundle): string =>
  Object.values(b).flatMap((c) =>
    c && typeof c == 'object' && 'title' in c && typeof c.title == 'string'
      ? [c.title]
      : []
  )[0] ?? ''

// The text a vocabulary searches on a row, in the order the row holds it: a
// property marked `search: true`, and the text a component says its entities
// are found by (`entry` by `content.body`).
let texts = (vocab: Vocab, b: Bundle): string[] =>
  Object.entries(b).flatMap(([name, comp]) => {
    if (!comp || typeof comp != 'object') return []
    let own = Object.entries(comp as Comp).flatMap(([prop, value]) =>
      typeof value == 'string' && vocab.prop(name, prop)?.search ? [value] : []
    )
    let by = (vocab.comp(name)?.search ?? []).flatMap((path) => {
      let [c, p] = path.split('.')
      let value = (b[c] as Comp | undefined)?.[p]
      return typeof value == 'string' ? [value] : []
    })
    return [...own, ...by]
  })

// The words as they match: each a prefix, as @yaks/fts matches a word, unless
// it is one letter; a quoted run as its phrase, across whatever separates its
// words in the text.
let LETTER = '[\\p{L}\\p{N}]'
let matcher = (words: string[]): RegExp | null => {
  let parts = words
    .map((w) => w.replace(/\*+$/, '').replaceAll('"', '').trim())
    .filter(Boolean)
    .map((w) =>
      w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\s+/g, '[^\\p{L}\\p{N}]+') +
      (w.length > 1 && !/\s/.test(w) ? `${LETTER}*` : `(?!${LETTER})`)
    )
  return parts.length
    ? new RegExp(`(?<!${LETTER})(?:${parts.join('|')})`, 'giu')
    : null
}

/** The part of `text` around the first match of `words`, every match in it
 * marked, on one line; the start of `text` when nothing matches.
 *
 * ```ts
 * import { snippet } from './hit.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal(snippet('The vale app.', ['mossvale']), 'The vale app.')
 * equal(snippet('Play  Mossvale\nnow', ['moss']), 'Play \x01Mossvale\x02 now')
 * equal(snippet('a cat, a dog', ['a']), '\x01a\x02 cat, \x01a\x02 dog')
 * equal(snippet('x '.repeat(60) + 'dragon', ['dragon']).startsWith('…'), true)
 * ```
 */
export let snippet = (text: string, words: string[]): string => {
  let line = text.replace(/\s+/g, ' ').trim()
  let match = matcher(words)
  let at = Math.max(match ? line.search(match) : 0, 0)
  let start = at > BEFORE ? line.lastIndexOf(' ', at - BEFORE) + 1 : 0
  let stop = line.indexOf(' ', at + AFTER)
  let end = stop < 0 ? line.length : stop
  let cut = line.slice(start, end)
  return (start ? '…' : '') +
    (match ? cut.replace(match, (m) => `\x01${m}\x02`) : cut) +
    (end < line.length ? '…' : '')
}

/** The hit a search row says itself as: its kind, its title, and a snippet of
 * the first text it is searched by, besides its title, that the words match,
 * or the start of the first such text when only the title matched: a line
 * that said its title twice would send its reader to read the row whole.
 * `cut` is a snippet already cut (@yaks/fts cuts one from its index), kept
 * unless it says only the title and the row has other text to say.
 *
 * ```ts
 * import { hit } from './hit.ts'
 * import { loadVocab } from '@yaks/vocab'
 * import { equal } from '@yaks/testing'
 *
 * let title = { type: 'string', search: true }
 * let body = { type: 'string', search: true }
 * let doc = { component: true, kind: true, properties: { title, body } }
 * let vocab = loadVocab({ $defs: { doc } })
 * let row = {
 *   entity: { eid: 'p1' },
 *   doc: { title: 'Mossvale', body: 'The vale app.' },
 * }
 * equal(hit(vocab, ['mossvale'])(row), {
 *   kind: 'doc',
 *   title: 'Mossvale',
 *   snippet: 'The vale app.',
 *   source: 'text',
 * })
 * equal(hit(vocab, ['mossvale'])(row, '\x01Mossvale\x02').snippet, 'The vale app.')
 * equal(hit(vocab, ['vale'])(row, 'The \x01vale\x02 app.').snippet, 'The \x01vale\x02 app.')
 * let bare = { entity: { eid: 'p2' }, doc: { title: 'Mossvale' } }
 * equal(hit(vocab, ['mossvale'])(bare, '\x01Mossvale\x02').snippet, '\x01Mossvale\x02')
 * ```
 */
export let hit =
  (vocab: Vocab, words: string[]) => (b: Bundle, cut?: string): Hit => {
    let title = titleOf(b)
    // deno-lint-ignore no-control-regex -- the marks @yaks/fts cuts with
    let plain = (cut ?? '').replace(/[\x01\x02…]/g, '').trim()
    return {
      kind: vocab.kindOf(b) || 'entity',
      title,
      snippet: plain && plain != title.trim()
        ? cut!
        : besides(vocab, words, b, title) || (cut ?? ''),
      source: 'text',
    }
  }

// The snippet of the first text a row is searched by, other than its title,
// that the words match, or of the first such text.
let besides = (vocab: Vocab, words: string[], b: Bundle, title: string) => {
  let said = texts(vocab, b).filter((t) => t != title)
  let match = matcher(words)
  let found = said.find((t) => match && t.search(match) >= 0) ?? said[0]
  return found ? snippet(found, words) : ''
}
