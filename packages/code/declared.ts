// The components each package declares, read from its `vocab.json` into the
// graph as @yaks/vocab's `_package`, `_comp`, `_prop` and `_before` entities,
// where the graph's vocabulary holds them (a config listing @yaks/vocab).
//
// A package's vocab.json is read on its own (@yaks/vocab `toBundles`), with
// its manifest's name and description. Its ids are derived from declared
// identities, so an `extends` entry's properties land on the component another
// package declares, whichever file was read first. The vocab.json is the
// source; if the file format ever becomes these bundles, `toBundles` is what
// goes, and the file's own bundles are written in its place.
//
// A row a package no longer declares is cleared the way a gone export is
// (./sync.ts): the entity stays, empty, and a `_before` edge is unlinked. Only
// a package's own rows are cleared, and never one another file in the same
// read declares, so a component that moves from one package to another lands
// on its new home in either order.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { unlink } from '@yaks/edge'
import { type Ids, toBundles, type VocabDoc } from '@yaks/vocab'

/** A package's vocabulary as read: its name and description, and its
 * document, or nothing when its vocab.json is gone. */
export type Said = { pkg: string; description?: string; doc?: VocabDoc }

let str = (v: unknown) => v == null ? '' : String(v)

/** What to write for these packages' vocabularies: every row each now
 * declares, and every row one declared before and no longer does, cleared. */
export let declared = async (
  g: Graph,
  id: Ids,
  said: Said[],
): Promise<Bundle[]> => {
  if (!said.length) return []
  let fresh = said.flatMap(({ pkg, description, doc }) =>
    doc ? toBundles({ ...doc, package: pkg, description }, id) as Bundle[] : []
  )
  let keep = new Set(fresh.map((b) => b.entity.eid))
  let linked = new Set(fresh.flatMap((b) => {
    let e = b.edge as Comp | undefined
    return b._before && e ? [`${e.from}|${e.to}`] : []
  }))
  let pkgs = said.map(({ pkg }) => id('_package', { name: pkg })).join(',')
  let [packages, comps, extensions, props] = await Promise.all([
    g.read(`._package .eid=${pkgs}`),
    g.read(`._comp.package=${pkgs}`),
    g.read(`._extends.package=${pkgs}`),
    g.read(`._prop.package=${pkgs}`),
  ])
  let from = comps.map((b) => b.entity.eid)
  let edges = from.length
    ? await g.read(`._before .edge.from=${from.join(',')} ?edge`)
    : []
  let gone = (name: string) => (b: Bundle) =>
    keep.has(b.entity.eid)
      ? []
      : [{ entity: b.entity, [name]: null, doc: null }]
  return [
    ...fresh,
    ...packages.flatMap(gone('_package')),
    ...comps.flatMap(gone('_comp')),
    ...extensions.flatMap(gone('_extends')),
    ...props.flatMap(gone('_prop')),
    ...edges.flatMap((b) => {
      let e = b.edge as Comp
      return linked.has(`${e.from}|${e.to}`)
        ? []
        : [unlink(str(e.from), '_before', str(e.to))]
    }),
  ]
}
