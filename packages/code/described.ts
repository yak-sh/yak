// The vocabulary a graph is served with, described in it as @yaks/vocab's
// `_package`, `_comp`, `_extends`, `_prop` and `_before` entities
// (@yaks/vocab `toBundles`), so the graph's own model is read, searched and
// linked like anything else, and a page about a component resolves.
//
// The served vocabulary is the one source: every document the host composed,
// each written with the package that brought it and that package's
// description, from its deno.json (@yaks/cli `compose`), so a package the
// checkout holds and the config does not list is not described.
//
// The graph's one `_vocab` holds the hash of every row as last described, so
// a graph whose hash matches is known to describe it, and is read no further:
// a process starting over an unchanged vocabulary costs that entity. Otherwise
// what is written is the difference, and the new hash with it. A row already
// saying what the vocabulary says is left alone. A row the vocabulary stopped
// declaring is cleared the way a gone export is (./sync.ts): the entity stays,
// empty, with any note left on it, and is filled in again if the component
// comes back. A `_before` edge it stopped saying is unlinked.
//
// Or a graph writes none of it and derives it when read (`describing`): the
// rows are the vocabulary's, the same for every graph served with it, so a
// host keeping many graphs on one vocabulary copies it into none of them.

import { map, type Pred, type Query } from '@yaks/query'
import type { Bundle, Comp, Graph, Plugin } from '@yaks/graph'
import { derivedEid, identities } from '@yaks/graph'
import { link, unlink } from '@yaks/edge'
import { type Ids, toBundles, type Vocab, type VocabDoc } from '@yaks/vocab'

let str = (v: unknown) => v == null ? '' : String(v)

// The rows a vocabulary is described in, in the order a batch writes them,
// so each reference lands on an entity written before it.
let ROWS = ['_package', '_comp', '_extends', '_prop', '_before', '_vocab']
let rank = (b: Bundle) => ROWS.findIndex((r) => b[r] !== undefined)

// A value as a string that is the same whatever order its keys are in, and
// where null is the same as nothing: what a store reads back for a column a
// row never set.
let canon = (v: unknown): string =>
  JSON.stringify(
    v,
    (_, x) =>
      x && typeof x == 'object' && !Array.isArray(x)
        ? Object.fromEntries(
          Object.entries(x).filter(([, y]) => y != null).toSorted(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          ),
        )
        : x,
  ) ?? 'null'

/**
 * Whether writing `fresh` over `held` would change anything: a component it
 * patches that `held` lacks, or a property whose value differs.
 *
 * ```ts
 * import { moves } from './described.ts'
 * let at = { entity: { eid: 'c' }, _comp: { name: 'note', kind: null } }
 * moves({ entity: { eid: 'c' }, _comp: { kind: null, name: 'note' } }, at) // false
 * moves({ entity: { eid: 'c' }, _comp: { name: 'task' } }, at) // true
 * moves({ entity: { eid: 'c' }, doc: { title: 'note' } }, at) // true
 * ```
 */
export let moves = (fresh: Bundle, held?: Bundle): boolean =>
  !held ||
  Object.entries(fresh).some(([name, c]) =>
    name != 'entity' && (!held[name] ||
      Object.entries(c as Comp).some(([k, v]) =>
        canon(v) != canon((held[name] as Comp)[k])
      ))
  )

// Two bundles of one entity, as one: what the later says over the earlier,
// where it says anything. Two documents of one package each describe it.
let merged = (a: Bundle, b: Bundle): Bundle =>
  Object.fromEntries(
    [...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [
      k,
      k == 'entity' ? a.entity : {
        ...a[k] as Comp,
        ...Object.fromEntries(
          Object.entries(b[k] as Comp ?? {}).filter(([, v]) => v != null),
        ),
      },
    ]),
  ) as Bundle

// The one entity that says what the rows were last described from.
let VOCAB = derivedEid('_vocab')

// The hex SHA-256 of a string.
let sha = async (s: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
    ),
  ].map((b) => b.toString(16).padStart(2, '0')).join('')

// Every row `docs` describe, by eid: two documents of one package describe it
// as one.
let rows = (vocab: Vocab, docs: VocabDoc[]): Map<string, Bundle> => {
  let derive = identities(vocab)
  let id: Ids = (comp, values) =>
    derive[comp](values as Comp, { entity: { eid: '' }, [comp]: values })
  let fresh = new Map<string, Bundle>()
  for (let doc of docs) {
    for (let b of toBundles(doc, id) as Bundle[]) {
      let e = b.edge as Comp | undefined
      let row = e ? link(str(e.from), '_before', str(e.to), Number(e.ord)) : b
      let was = fresh.get(row.entity.eid)
      fresh.set(row.entity.eid, was ? merged(was, row) : row)
    }
  }
  return fresh
}

/** What to write so `g` describes `docs`, the vocabulary it is served with:
 * every row that is missing or says something else, every row it holds that
 * `docs` no longer declares, cleared, and the hash of the rows as described
 * (`_vocab`). A graph whose hash already matches is not read further and is
 * written nothing; nor is one that cannot hold a vocabulary (@yaks/vocab not
 * composed). A single-owner host can supply its previously committed docs to
 * select only changed identities rather than read every description. */
export let described = async (
  g: Graph,
  docs: VocabDoc[],
  previous?: VocabDoc[],
): Promise<Bundle[]> => {
  if (!g.vocab.comp('_vocab')) return []
  let fresh = rows(g.vocab, docs)
  let [was] = await g.get([VOCAB], ['_vocab'])
  let hash = await sha(canon([...fresh.values()]))
  if ((was?._vocab as Comp | undefined)?.hash == hash) return []
  // A single-owner host can retain the last accepted declaration outside the
  // graph. Select only changed identities; the global hash remains the
  // commit marker, so an interrupted pass is diffed again from its old docs.
  let before = previous && rows(g.vocab, previous)
  let changed = before &&
    [...fresh.values()].filter((b) =>
      canon(b) != canon(before.get(b.entity.eid))
    )
  let gone = before && [...before.keys()].filter((id) => !fresh.has(id))
  let held = changed && gone
    ? await g.get([...changed.map((b) => b.entity.eid), ...gone])
    : (await Promise.all([
      g.read('._package ?doc'),
      g.read('._comp ?doc'),
      g.read('._extends ?doc'),
      g.read('._prop ?doc'),
      g.read('._before ?edge'),
    ])).flat()
  let at = new Map(held.map((b) => [b.entity.eid, b]))
  let cleared = (b: Bundle): Bundle => {
    let e = b.edge as Comp | undefined
    return e ? unlink(str(e.from), '_before', str(e.to)) : {
      entity: { eid: b.entity.eid },
      [ROWS[rank(b)]]: null,
      doc: null,
    }
  }
  return [
    ...(changed ?? [...fresh.values()]).filter((b) =>
      moves(b, at.get(b.entity.eid))
    ),
    ...held.filter((b) => rank(b) >= 0 && !fresh.has(b.entity.eid)).map(
      cleared,
    ),
    { entity: { eid: VOCAB }, _vocab: { hash } },
  ].toSorted((a, b) => rank(a) - rank(b))
}

// The components a description is made of. `_vocab` is not one: it says what
// a graph last wrote. Only a vocabulary says what a component is, so a stored
// one of those is what an earlier copy left; a package can be a graph's own
// (@yaks/lens names one for its steps to point at).
let META = ROWS.slice(0, -1)
let SAID = META.slice(1)

// `!name`: an entity without it.
let absent = (c: Pred) =>
  c.op == '=' && c.value?.kind == 'scalar' && !c.value.raw

// A vocabulary's description, derived once for as long as it is served.
let derivations = new WeakMap<Vocab, Map<string, Bundle>>()
let derive = (vocab: Vocab) => {
  let held = derivations.get(vocab)
  if (!held) derivations.set(vocab, held = rows(vocab, vocab.docs))
  return held
}

// Whether a query can match a description: a clause names one of its
// components, other than to want it or leave it out, or one of its entities.
let asks = (query: Query, held: Map<string, Bundle>): boolean => {
  let named = (path: string[]) => path.some((p) => META.includes(p))
  let says = (raw?: string) => raw != null && held.has(raw)
  let hit = false
  map(query, (c) => {
    hit ||= c.kind == 'pred'
      ? named(c.path) && c.op != '?' && !absent(c) ||
        (c.value?.kind == 'scalar' && says(c.value.raw)) ||
        (c.value?.kind == 'list' &&
          c.value.items.some((v) => v.kind == 'scalar' && says(v.raw)))
      : c.kind == 'order'
      ? named(c.value.replace(/^-/, '').split('.'))
      : c.kind == 'fields'
      ? c.fields.some((f) => named(f.path))
      : c.kind == 'tally' || c.kind == 'distinct'
      ? named(c.path)
      : c.kind == 'refs'
      ? says(c.value)
      : false
    return c
  })
  return hit
}

/**
 * The description of the vocabulary a graph is served with, derived when
 * read rather than stored: a plugin that answers every query that can match
 * one of its rows from what storage holds and the rows the vocabulary
 * describes, the same rows `described` would write. A stored row on an entity
 * the vocabulary describes, or one saying what a component is, is what an
 * earlier copy left, and is not read. A walk from a stored entity into a
 * description is answered by storage alone.
 */
export let describing: Plugin = {
  name: '@yaks/code describing',
  view: ({ vocab }, original) => {
    if (!vocab?.comp('_comp')) return null
    let held = derive(vocab)
    if (!asks(original, held)) return null
    let stale = (b: Bundle) => held.has(b.entity.eid) || SAID.some((r) => b[r])
    return {
      original,
      query: original,
      vocab,
      // The derived rows move only with the vocabulary: a write reaches the
      // answer through what it stores, a component the query names (which a
      // subscription notices) or a description component itself.
      dependencies: META,
      answer: (stored) => [
        ...stored.filter((b) => !stale(b)),
        ...held.values(),
      ],
    }
  },
}
