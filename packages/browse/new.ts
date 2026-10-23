// New entities, sketched before they are made. A sketch is what a person has
// typed toward them: the components chosen, the text typed in each property,
// and an outline whose lines become more entities, nested by `contains`. It is
// the person's draft (@yaks/draft), so it is kept as it is typed and seen in
// every interface; the batch it writes is derived from it here, whole, so it
// can be shown before it is sent. The batch names what it makes by alias
// (`$1`), and the graph mints each id, or derives it where a component's
// identity says (a link's ends and relation), so the page never guesses one.
//
// Nothing here reads the page: the vocabulary, and a reader for typed text,
// are handed in.
import type { Bundle, Comp } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'

/** What a person has typed toward new entities: each component chosen, with
 * the text typed in each of its properties, and an outline. */
export type Sketch = {
  comps: Record<string, Record<string, string>>
  outline: string
}

/** Where a sketch is made: in an entity (`contains`), like another. Each is
 * an eid. */
export type At = { in?: string; like?: string }

/** The draft a sketch is kept in: one per place it is made from.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * equal(placeOf({}), 'new')
 * equal(placeOf({ in: 'p', like: 'l' }), 'new:in:p:like:l')
 * ```
 */
export let placeOf = (at: At): string =>
  [
    'new',
    ...(at.in ? ['in', at.in] : []),
    ...(at.like ? ['like', at.like] : []),
  ].join(':')

/// sketchOf('') -> undefined
/// sketchOf('{"comps":{"task":{}},"outline":"a"}') -> {comps: {task: {}}, outline: 'a'}
export let sketchOf = (text: string): Sketch | undefined => {
  if (!text) return undefined
  let s = JSON.parse(text) as Partial<Sketch>
  return { comps: s.comps ?? {}, outline: s.outline ?? '' }
}

/** A sketch as its draft's text. */
export let textOf = (s: Sketch): string => JSON.stringify(s)

// What a client may write: never the spine, never a word only the server
// writes.
let writable = (v: Vocab, name: string) =>
  name != 'entity' && !!v.comp(name)?.wire

// A component that records what happened to one entity (a stamp, a mark, a
// claim) is its history, not the kind of thing it is.
let history = (v: Vocab, name: string) =>
  v.props(name).some((p) => v.prop(name, p)?.stamped)

/** A blank sketch of what an entity is made of: each component it carries
 * that a client may write, without its values or its history. */
export let like = (v: Vocab, has: Record<string, unknown>): Sketch => ({
  comps: Object.fromEntries(
    Object.keys(has)
      .filter((n) => writable(v, n) && !history(v, n))
      .map((n) => [n, {}]),
  ),
  outline: '',
})

/** A component as the owner reads one: its name and its properties. */
export let signature = (v: Vocab, name: string): string =>
  `${name}{${v.props(name).join(', ')}}`

// A description's first sentence: enough to choose by.
let brief = (text = '') => text.split(/(?<=[.;])\s/)[0]

/** A component a search offers. */
export type Hit = { name: string; signature: string; about: string }

// How well a word names a component: its name, the start of its name, inside
// its name, or inside what it is said to be. Unnamed, it doesn't.
let fit = (name: string, about: string, word: string) =>
  name == word
    ? 0
    : name.startsWith(word)
    ? 1
    : name.includes(word)
    ? 2
    : about.toLowerCase().includes(word)
    ? 3
    : Infinity

/** The components a search names, best first, leaving out those `held`: every
 * word of `q` in its name or its description. */
export let find = (
  v: Vocab,
  q: string,
  held: string[] = [],
  most = 8,
): Hit[] => {
  let words = q.toLowerCase().split(/\s+/).filter(Boolean)
  return v.all
    .filter((name) => writable(v, name) && !held.includes(name))
    .map((name) => {
      let about = brief(v.def(name)?.description)
      let rank = Math.max(0, ...words.map((w) => fit(name, about, w)))
      return { name, about, rank }
    })
    .filter((h) => h.rank < Infinity)
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, most)
    .map(({ name, about }) => ({ name, signature: signature(v, name), about }))
}

/** One line of an outline: what it says, and the line it nests under. */
export type Line = { title: string; under?: number }

/** An outline's lines: each nests under the nearest line above it that is
 * indented less, and a list's bullet is not part of what it says.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * equal(lines('Plan\n  - Name it\n    Ask\n  Buy\n\nShip'), [
 *   { title: 'Plan' },
 *   { title: 'Name it', under: 0 },
 *   { title: 'Ask', under: 1 },
 *   { title: 'Buy', under: 0 },
 *   { title: 'Ship' },
 * ])
 * ```
 */
export let lines = (text: string): Line[] => {
  let out: Line[] = [], open: { indent: number; at: number }[] = []
  for (let raw of text.replaceAll('\t', '  ').split('\n')) {
    let title = raw.trim().replace(/^[-*+]\s+/, '')
    if (!title) continue
    let indent = raw.length - raw.trimStart().length
    while (open.length && open.at(-1)!.indent >= indent) open.pop()
    let under = open.at(-1)?.at
    open.push({ indent, at: out.length })
    out.push(under == null ? { title } : { title, under })
  }
  return out
}

/** An outline typed into, as a key leaves it: Enter starts a line at the
 * indent of the one the caret is on, Tab indents that line and Shift+Tab
 * takes an indent off it. Any other key is the field's own.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * equal(press('A\n  B', 6, 'Enter'), { text: 'A\n  B\n  ', at: 9 })
 * equal(press('A\nB', 3, 'Tab'), { text: 'A\n  B', at: 5 })
 * equal(press('A\n  B', 5, 'Tab', true), { text: 'A\nB', at: 3 })
 * equal(press('A', 1, 'x'), undefined)
 * ```
 */
export let press = (
  text: string,
  at: number,
  key: string,
  shift = false,
): { text: string; at: number } | undefined => {
  let start = text.lastIndexOf('\n', at - 1) + 1
  let indent = /^ */.exec(text.slice(start))![0]
  let put = (from: number, to: number, add: string, caret: number) => ({
    text: text.slice(0, from) + add + text.slice(to),
    at: caret,
  })
  if (key == 'Enter') return put(at, at, `\n${indent}`, at + 1 + indent.length)
  if (key != 'Tab') return undefined
  if (!shift) return put(start, start, '  ', at + 2)
  let cut = Math.min(2, indent.length)
  return put(start, start + cut, '', Math.max(start, at - cut))
}

/** What writing a sketch needs besides the sketch. */
export type Context = {
  vocab: Vocab
  /** a property's typed text as its value; throws what it could not read */
  read: (comp: string, prop: string, text: string) => unknown
  /** the entity it is made in, and the place in that entity's list to start
   * from */
  in?: string
  ord?: number
}

/** Input the sketch holds that cannot be written as it stands: a field it
 * is about, or an outline line, and why. */
export type Said = { comp?: string; prop?: string; line?: number; said: string }

/** A sketch as the batch it writes: its bundles, what in it cannot be read,
 * and each entity it makes by alias, with the outline line it came from. */
export type Batch = {
  bundles: Bundle[]
  said: Said[]
  made: { alias: string; line?: number }[]
}

// Every typed property read as its value; what cannot be read is said, and
// left out.
let values = (s: Sketch, cx: Context, said: Said[]) =>
  Object.fromEntries(
    Object.entries(s.comps).map(([comp, typed]) => [
      comp,
      Object.fromEntries(
        Object.entries(typed).flatMap(([prop, text]) => {
          if (!text.trim()) return []
          try {
            return [[prop, cx.read(comp, prop, text.trim())]]
          } catch (e) {
            said.push({
              comp,
              prop,
              said: e instanceof Error ? e.message : String(e),
            })
            return []
          }
        }),
      ),
    ]),
  ) as Record<string, Comp>

// What identifies a component's entity among its kind: the properties its id
// is derived from, or else one no two of them share (a topic's name).
let keyOf = (v: Vocab, name: string): string[] => {
  let identity = v.identity(name)
  return identity.length
    ? identity
    : v.indexes(name).flatMap((i) =>
      i.unique && !i.present && i.props.length == 1 ? i.props : []
    )
}

// Whether what was typed names the entity: a title, or what identifies it.
let named = (v: Vocab, comps: Record<string, Comp>) =>
  comps.doc?.title != null ||
  Object.entries(comps).some(([name, c]) =>
    keyOf(v, name).some((p) => c[p] != null)
  )

// An outline line's entity: the sketch's values, its line the title and what
// identifies it where the sketch left that empty.
let titled = (v: Vocab, comps: Record<string, Comp>, title: string) => {
  let out: Record<string, Comp> = { ...comps }
  if (v.comp('doc')) out.doc = { ...out.doc, title }
  for (let [name, c] of Object.entries(comps)) {
    for (let p of keyOf(v, name)) {
      if (c[p] == null) out[name] = { ...out[name], [p]: title }
    }
  }
  return out
}

// That `from` contains `to`, `ord` its place in the list.
let contains = (alias: string, from: string, to: string, ord: number) => ({
  entity: { eid: alias },
  edge: { from, to, ord },
  contains: {},
})

// The `contains` edges, each list in order: one in an entity that already
// exists goes on from `cx.ord`.
let edges = (cx: Context, links: [string | undefined, string][]) => {
  if (!cx.vocab.comp('contains')) return []
  let next = new Map<string, number>()
  return links
    .filter((l): l is [string, string] => !!l[0])
    .map(([from, to], i) => {
      let ord = next.get(from) ?? (from == cx.in ? cx.ord ?? 0 : 0)
      next.set(from, ord + 1)
      return contains(`$e${i + 1}`, from, to, ord)
    })
}

/**
 * The batch a sketch writes. With no outline it makes one entity. With one,
 * each line is an entity like the sketch, titled by its line and nested by
 * `contains` as it is indented; the sketch itself is the entity they are made
 * in when it names one (a title, or what identifies it). Whatever is made at
 * the top goes in `cx.in`.
 */
export let batch = (s: Sketch, cx: Context): Batch => {
  let said: Said[] = []
  let comps = values(s, cx, said)
  let outline = lines(s.outline)
  let root = Object.keys(comps).length > 0 &&
    (!outline.length || named(cx.vocab, comps))
  let alias = (line: number) => `$${line + (root ? 2 : 1)}`
  let made: Batch['made'] = [
    ...(root ? [{ alias: '$1' }] : []),
    ...outline.map((_, line) => ({ alias: alias(line), line })),
  ]
  let bundles: Bundle[] = made.map(({ alias, line }) => ({
    entity: { eid: alias },
    ...(line == null ? comps : titled(cx.vocab, comps, outline[line].title)),
  }))
  let under = (line?: number) => {
    let up = line == null ? undefined : outline[line].under
    return line == null ? cx.in : up != null ? alias(up) : root ? '$1' : cx.in
  }
  let links = made.map((m) =>
    [under(m.line), m.alias] as [string | undefined, string]
  )
  return { bundles: [...bundles, ...edges(cx, links)], said, made }
}

/** A bundle as one line of what a batch writes: the entity, then each
 * component with what it says, an existing entity named as `name` calls it.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * let edge = {
 *   entity: { eid: '$e1' },
 *   edge: { from: 'p', to: '$1', ord: 0 },
 *   contains: {},
 * }
 * equal(written(edge, () => 'T-9'), '$e1  edge{from: T-9, to: $1, ord: 0}  contains{}')
 * equal(written({ entity: { eid: '$1' }, doc: { title: 'Go' } }), '$1  doc{title: "Go"}')
 * ```
 */
export let written = (
  b: Bundle,
  name: (eid: string) => string | undefined = () => undefined,
): string => {
  let face = (v: unknown) =>
    typeof v == 'string' && (v.startsWith('$') ? v : name(v)) ||
    JSON.stringify(v)
  let { entity, ...rest } = b
  return [
    entity.eid,
    ...Object.entries(rest as Record<string, Comp>).map(([comp, c]) =>
      `${comp}{${
        Object.entries(c).map(([k, v]) => `${k}: ${face(v)}`).join(', ')
      }}`
    ),
  ].join('  ')
}

/** A write refused, placed where it belongs: on the field it names, when the
 * sketch has that field, and on the outline line whose entity it names. A
 * refusal from the server arrives as an error's `refusal`, one from the
 * page's own admission as the error itself. */
export let placed = (error: unknown, b: Batch, s: Sketch): Said => {
  let r = ((error as { refusal?: unknown })?.refusal ?? error) as {
    eid?: string
    comp?: string
    prop?: string
    message?: string
  }
  let line = b.made.find((m) => m.alias == r?.eid)?.line
  let field = r?.comp && r.prop && s.comps[r.comp]
  return {
    ...field && { comp: r.comp, prop: r.prop },
    ...line != null && { line },
    said: r?.message ?? String(error),
  }
}
