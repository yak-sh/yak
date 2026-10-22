// What a row a search found says of itself in one line: its id, its kind, its
// title, and a snippet of its text around the words that found it, each match
// marked `\x01`…`\x02` as @yaks/fts marks one. The `search` tool answers this
// `hit` alone; `graph_query` paints it on the whole rows a search answers, so
// a model reads one line a row (@yaks/tools `worded`) while `--json` and
// structured content keep every component.
import type { Bundle, Comp } from './bundle.ts'
import type { Vocab } from '@yaks/vocab'
import { idOf } from '@yaks/id'

/** A search row's line: which row it is, what it is, what it is called, the
 * words around the match, and that words found it. */
export type Hit = {
  id: string
  kind: string
  title: string
  snippet: string
  source: 'text'
}

// What a row is, as its line says: the kind its components make it, or
// `entity` when they make it none.
let kindOf = (vocab: Vocab, b: Bundle): string => vocab.kindOf(b) || 'entity'

/** The id a line names a row by: its human id (`P-45602`) where it has a
 * number, which a reader copies without slipping a digit, else its eid. Not
 * the short handle a terminal shows (`#7e75052a20`): only @yaks/id's plugin
 * resolves one, and the eid is the id every graph takes.
 *
 * ```ts
 * import { called } from './hit.ts'
 * import { loadVocab } from '@yaks/vocab'
 * import { equal } from '@yaks/testing'
 *
 * let project = { component: true, kind: true, properties: {} }
 * let say = called(loadVocab({ $defs: { project } }))
 * equal(say({ entity: { eid: 'e1', num: 45602 }, project: {} }), 'P-45602')
 * equal(say({ entity: { eid: 'e1' }, project: {} }), 'e1')
 * ```
 */
export let called = (vocab: Vocab): (b: Bundle) => string => {
  let id = idOf(vocab)
  return (b) =>
    b.entity.num
      ? id({ eid: b.entity.eid, kind: kindOf(vocab, b), num: b.entity.num })
      : b.entity.eid
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
//
// A text is read as its runs of letters and digits, through one regular
// expression made once: a pattern holding a Unicode property costs about a
// millisecond to compile, so one made for each search's words cost more than
// the search's snippets. A word matches a run it starts, or equals when it is
// one letter or part of a phrase; a phrase matches consecutive runs.
let WORD = /[\p{L}\p{N}]+/gu
type Wanted = { runs: string[]; prefix: boolean }
let runs = (text: string) =>
  [...text.matchAll(WORD)].map((m) => ({
    at: m.index,
    end: m.index + m[0].length,
    low: m[0].toLowerCase(),
  }))
let matcher = (words: string[]): Wanted[] | null => {
  let wanted = words
    .map((w) => w.replace(/\*+$/, '').replaceAll('"', '').trim())
    .map((w) => ({
      runs: runs(w).map((r) => r.low),
      prefix: w.length > 1 && !/\s/.test(w),
    }))
    .filter((w) => w.runs.length)
  return wanted.length ? wanted : null
}

// Where the words match in `text`, first to last, none overlapping.
let spans = (text: string, wanted: Wanted[]): [number, number][] => {
  let rs = runs(text)
  let found: [number, number][] = []
  for (let i = 0; i < rs.length;) {
    let w = wanted.find(({ runs: q, prefix }) =>
      q.every((r, j) => {
        let low = rs[i + j]?.low
        return low != null &&
          (prefix && j == q.length - 1 ? low.startsWith(r) : low == r)
      })
    )
    if (!w) {
      i++
      continue
    }
    found.push([rs[i].at, rs[i + w.runs.length - 1].end])
    i += w.runs.length
  }
  return found
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
 * equal(snippet('in the vale, app', ['"vale app"']), 'in the \x01vale, app\x02')
 * equal(snippet('Été au café', ['ete', 'CAF']), 'Été au \x01café\x02')
 * ```
 */
export let snippet = (text: string, words: string[]): string => {
  let line = text.replace(/\s+/g, ' ').trim()
  let wanted = matcher(words)
  let found = wanted ? spans(line, wanted) : []
  let at = found[0]?.[0] ?? 0
  let start = at > BEFORE ? line.lastIndexOf(' ', at - BEFORE) + 1 : 0
  let stop = line.indexOf(' ', at + AFTER)
  let end = stop < 0 ? line.length : stop
  let cut = ''
  let from = start
  for (let [a, b] of found.filter(([, b]) => b <= end)) {
    cut += `${line.slice(from, a)}\x01${line.slice(a, b)}\x02`
    from = b
  }
  cut += line.slice(from, end)
  return (start ? '…' : '') + cut + (end < line.length ? '…' : '')
}

/** The hit a search row says itself as: the id it is {@link called}, its
 * kind, its title, and a snippet of
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
 *   id: 'p1',
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
export let hit = (
  vocab: Vocab,
  words: string[],
): (b: Bundle, cut?: string) => Hit => {
  let id = called(vocab)
  return (b: Bundle, cut?: string): Hit => {
    let title = titleOf(b)
    // deno-lint-ignore no-control-regex -- the marks @yaks/fts cuts with
    let plain = (cut ?? '').replace(/[\x01\x02…]/g, '').trim()
    return {
      id: id(b),
      kind: kindOf(vocab, b),
      title,
      snippet: plain && plain != title.trim()
        ? cut!
        : besides(vocab, words, b, title) || (cut ?? ''),
      source: 'text',
    }
  }
}

// The snippet of the first text a row is searched by, other than its title,
// that the words match, or of the first such text.
let besides = (vocab: Vocab, words: string[], b: Bundle, title: string) => {
  let said = texts(vocab, b).filter((t) => t != title)
  let wanted = matcher(words)
  let found = said.find((t) => wanted && spans(t, wanted).length) ?? said[0]
  return found ? snippet(found, words) : ''
}
