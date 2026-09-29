// A vocabulary described as entities, in the meta vocabulary (./meta/vocab.json):
// a `_comp` per component a document declares, a `_prop` per property, and a
// `_before` edge per kind a kind sorts before, each wearing `doc` for its name
// and its description. A vocabulary is then read, searched and linked like
// anything else in a graph, and what `graph_schema` answers is a query:
//
//   ._comp ?doc                    every component, by name
//   ._prop.comp._comp.name=mail    mail's properties (`.order=_prop.ord`)
//   ._prop.ref=mail                what refers to mail
//   ._before .edge.from=<mail>     the kinds mail sorts before
//
// `toBundles` reads one document on its own, so a file is read on its own
// (@yaks/code reads each package's vocab.json this way). What joins two
// documents is their ids: a `_comp` is identified by its name, a `_prop` by
// its component and its name — declared identities a graph derives — so an
// `extends` entry's properties land on the component another package
// declares, and neither document knows the other. `fromBundles` goes back, to
// documents `loadVocab` takes.
//
// A keyword with a column of its own is written there, and every other one an
// entry says — another package's (`prefix`, `store`) or JSON Schema's own
// (`minLength`) — rides verbatim in `keywords`, so nothing a document says is
// lost on the way through.

import { metaDoc } from './meta.ts'
import type { PropSchema, VocabDoc } from './types.ts'

/**
 * One entity as a graph writes it: its id under `entity`, each component under
 * its own name. The structural shape of @yaks/graph's `Bundle`, declared here
 * rather than imported, since @yaks/graph imports this package.
 */
export type Bundle = {
  entity: { eid: string }
  [comp: string]: Record<string, unknown> | null | boolean | string | undefined
}

/**
 * The id a component's declared identity gives these values: a graph's own
 * derivation (@yaks/graph `identities`), so a projection lands on the same
 * entities in every graph that reads it.
 */
export type Ids = (
  comp: '_comp' | '_prop',
  values: Record<string, unknown>,
) => string

// The columns the meta vocabulary gives a component and a property, less the
// ones the projection fills itself rather than copying off a schema.
let columns = (comp: string, own: string[]) =>
  Object.keys(metaDoc.$defs![comp].properties!).filter((k) => !own.includes(k))
let OWN = ['name', 'package', 'keywords']
let COMP = columns('_comp', OWN)
let PROP = columns('_prop', [...OWN, 'comp', 'ord', 'required'])

// What a component entry says by its shape rather than by a keyword: that it
// is one, its properties, and the lists that become rows and edges.
let SHAPE = [
  'component',
  'extends',
  'type',
  'description',
  'properties',
  'required',
  'before',
  'package',
]

// A schema's keywords as columns: each column set, or null where the schema
// says nothing — a row states its whole self, so a keyword a file stopped
// saying is cleared — and every keyword without a column in `keywords`.
let row = (s: PropSchema, cols: string[], skip: string[]) => {
  let rest = Object.entries(s).filter(([k]) =>
    !cols.includes(k) && !skip.includes(k)
  )
  return {
    ...Object.fromEntries(cols.map((k) => [k, s[k] ?? null])),
    keywords: rest.length ? Object.fromEntries(rest) : null,
  }
}

/**
 * One document's components as bundles: a `_comp` for each it declares, a
 * `_prop` for each property it declares or adds (`extends`), a `_before` edge
 * for each kind its `before` names, and a bare `{entity}` for each component
 * it only names, so every reference lands on an entity that exists. A tool, a
 * rule or any other entry that is not a component is left out.
 *
 * ```ts
 * let id = (comp: string, v: Record<string, unknown>) =>
 *   `${comp}:${Object.values(v).join('.')}`
 * let doc = { $defs: { note: { component: true, properties: {
 *   text: { type: 'string', description: 'what it says' },
 * } } } }
 * toBundles(doc, id)[1]
 * // { entity: { eid: '_prop:_comp:note.text' },
 * //   _prop: { comp: '_comp:note', name: 'text', ord: 0, type: 'string', … },
 * //   doc: { title: 'note.text', body: 'what it says' } }
 * ```
 */
export let toBundles = (doc: VocabDoc, id: Ids): Bundle[] => {
  let pkg = doc.package ?? null
  let named = new Set<string>()
  let comp = (name: string) => {
    let eid = id('_comp', { name })
    named.add(eid)
    return eid
  }
  let comps: Bundle[] = []
  let props: Bundle[] = []
  let edges: Bundle[] = []
  for (let [name, s] of Object.entries(doc.$defs ?? {})) {
    if (s?.component !== true) continue
    let c = comp(name)
    if (!s.extends) {
      comps.push({
        entity: { eid: c },
        _comp: { name, package: pkg, ...row(s, COMP, SHAPE) },
        doc: { title: name, body: s.description ?? null },
      })
      s.before?.forEach((kind, ord) => {
        let to = comp(kind)
        edges.push({
          entity: { eid: `$_before:${c}:${to}` },
          edge: { from: c, to, ord },
          _before: {},
        })
      })
    }
    Object.entries(s.properties ?? {}).forEach(([prop, p], ord) =>
      props.push({
        entity: { eid: id('_prop', { comp: c, name: prop }) },
        _prop: {
          comp: c,
          name: prop,
          ord,
          package: pkg,
          required: s.required?.includes(prop) || null,
          ...row(p, PROP, ['description']),
        },
        doc: { title: `${name}.${prop}`, body: p.description ?? null },
      })
    )
  }
  let declared = new Set(comps.map((b) => b.entity.eid))
  let mentions = [...named].filter((eid) => !declared.has(eid))
    .map((eid) => ({ entity: { eid } }))
  return [...mentions, ...comps, ...props, ...edges]
}

// A component's columns as read back, without the nulls a store fills an
// absent column with.
let kept = (b: Bundle, name: string): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(b[name] as Record<string, unknown>).filter(([, v]) =>
      v != null
    ),
  )

let described = (b: Bundle) => {
  let body = (b.doc as { body?: string } | null | undefined)?.body
  return body ? { description: body } : {}
}

/**
 * Bundles back into documents: one per package, each declaring that package's
 * components, and an `extends` entry wherever a package added properties to a
 * component another one declares. `loadVocab` of what it returns is the
 * vocabulary the bundles were projected from. It reads the rows a graph holds
 * (`._comp`, `._prop`, `._before`), with whatever else those entities wear.
 * An edge to an entity no `_comp` names is a kind these bundles never declared,
 * and is left out.
 */
export let fromBundles = (bundles: Bundle[]): VocabDoc[] => {
  let named = new Map<string, { name: string; pkg: string }>()
  let docs = new Map<string, Record<string, PropSchema>>()
  let defs = (pkg: string) => docs.get(pkg) ?? docs.set(pkg, {}).get(pkg)!
  for (let b of bundles.filter((b) => b._comp)) {
    let { name, package: pkg = '', keywords, ...cols } = kept(b, '_comp')
    named.set(b.entity.eid, { name: String(name), pkg: String(pkg) })
    defs(String(pkg))[String(name)] = {
      component: true,
      type: 'object',
      ...keywords as object,
      ...cols,
      ...described(b),
      properties: {},
    }
  }
  let ord = (b: Bundle, name: string, key: string) =>
    Number((b[name] as Record<string, unknown>)[key] ?? 0)
  let props = bundles.filter((b) => b._prop)
    .sort((a, b) => ord(a, '_prop', 'ord') - ord(b, '_prop', 'ord'))
  for (let b of props) {
    let { comp, name, ord: _, package: pkg = '', required, keywords, ...cols } =
      kept(b, '_prop')
    let home = named.get(String(comp))
    if (!home) continue
    let at = defs(String(pkg))
    let entry = at[home.name] ??= {
      component: true,
      extends: true,
      properties: {},
    }
    entry.properties![String(name)] = {
      ...keywords as object,
      ...cols,
      ...described(b),
    }
    if (required) entry.required = [...entry.required ?? [], String(name)]
  }
  let edges = bundles.filter((b) => b._before && b.edge)
    .sort((a, b) => ord(a, 'edge', 'ord') - ord(b, 'edge', 'ord'))
  for (let b of edges) {
    let { from, to } = b.edge as { from: string; to: string }
    let [kind, target] = [named.get(from), named.get(to)]
    if (!kind || !target) continue
    let entry = defs(kind.pkg)[kind.name]
    entry.before = [...entry.before ?? [], target.name]
  }
  return [...docs].map(([pkg, $defs]) => ({
    ...(pkg ? { package: pkg } : {}),
    $defs,
  }))
}
