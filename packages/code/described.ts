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

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid, identities } from '@yaks/graph'
import { link, unlink } from '@yaks/edge'
import { type Ids, toBundles, type VocabDoc } from '@yaks/vocab'

let str = (v: unknown) => v == null ? '' : String(v)

// The rows a vocabulary is described in, in the order a change writes them,
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
let rows = (g: Graph, docs: VocabDoc[]): Map<string, Bundle> => {
  let derive = identities(g.vocab)
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
 * composed). */
export let described = async (
  g: Graph,
  docs: VocabDoc[],
): Promise<Bundle[]> => {
  if (!g.vocab.comp('_vocab')) return []
  let fresh = rows(g, docs)
  let [was] = await g.get([VOCAB], ['_vocab'])
  let hash = await sha(canon([...fresh.values()]))
  if ((was?._vocab as Comp | undefined)?.hash == hash) return []
  let held = (await Promise.all([
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
    ...[...fresh.values()].filter((b) => moves(b, at.get(b.entity.eid))),
    ...held.filter((b) => !fresh.has(b.entity.eid)).map(cleared),
    { entity: { eid: VOCAB }, _vocab: { hash } },
  ].toSorted((a, b) => rank(a) - rank(b))
}
