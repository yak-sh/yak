// A vocabulary described as entities, in the meta vocabulary (./vocab.json): a
// `_package` for the package a document is, a `_comp` per component it
// declares, a `_kind` per kind it declares (./kinds.ts), an `_extends` per
// component it extends (the status rungs it adds), a `_prop` per property it
// declares or extends, an `_effect` per effect it declares, and a `_before`
// edge per kind a kind sorts before, each wearing `doc` for its name and its
// description. A vocabulary is then read, searched and linked like anything
// else in a graph, and what `graph_schema` answers is a query:
//
//   ._comp ?doc                    every component, by name
//   ._prop.comp._comp.name=mail    mail's properties (`.order=_prop.ord`)
//   ._prop.ref=mail                what refers to mail
//   ._kind.name=decision           what makes a decision
//   ._before .edge.from=<decision> the kinds a decision sorts before
//   ._prop.package=<@yaks/id>      what a package declares and extends
//   ._effect.package=<@yaks/mail>  the effects a package declares
//
// `toBundles` reads one document on its own, so a file is read on its own
// (@yaks/code reads each package's vocab.json this way). What joins two
// documents is their ids: a `_package`, a `_comp`, a `_kind` and an `_effect`
// are identified by their names, a `_prop` by its component and its name —
// declared identities a graph derives — so an `extends` entry's properties
// land on the component another package declares, and neither document knows
// the other.
// `fromBundles` goes back, to documents `loadVocab` takes.
//
// A keyword with a column of its own is written there, and every other one an
// entry says — another package's (`prefix`, `store`) or JSON Schema's own
// (`minLength`) — rides verbatim in `keywords`, so nothing a document says is
// lost on the way through.

import { type KindDecl, kindsIn } from './kinds.ts'
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
  comp: '_package' | '_comp' | '_kind' | '_effect' | '_extends' | '_prop',
  values: Record<string, unknown>,
) => string

// The columns the meta vocabulary gives a component and a property, less the
// ones the projection fills itself rather than copying off a schema.
let columns = (comp: string, own: string[]) =>
  Object.keys(metaDoc.$defs![comp].properties!).filter((k) => !own.includes(k))
let OWN = ['name', 'package', 'keywords']
let COMP = columns('_comp', OWN)
let PROP = columns('_prop', [...OWN, 'comp', 'ord', 'required'])
let EFFECT = columns('_effect', OWN)

// What a component entry says by its shape rather than by a keyword: that it
// is one, its properties, and the lists that become rows and edges. A
// component that is the kind of its own name says so in `kind`, `prefix` and
// `before`, which its `_kind` row and `_before` edges hold.
let SHAPE = [
  'component',
  'extends',
  'type',
  'description',
  'properties',
  'required',
  'kind',
  'prefix',
  'before',
  'package',
]

// What an effect entry says by its shape: that it is one, and what it does.
let EFFECT_SHAPE = ['effect', 'description']

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
 * One document's vocabulary as bundles: a `_package` where the document names
 * its `package` (its `description` the package's), a `_comp` for each component
 * it declares, a `_kind` for each kind it declares, under `kinds` or as a
 * component of the kind's name, an `_extends` for each component it extends, a
 * `_prop` for each property it declares or adds, a `_before` edge for each
 * kind a kind's `before` names, and an `_effect` for each effect it declares.
 * A component or kind it only names (`before`, `extends`) is referred to by
 * the id its name derives, whichever document declares it. A tool, a rule or
 * any other entry that is neither a component nor an effect is left out.
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
  let pkg = doc.package ? id('_package', { name: doc.package }) : null
  let comp = (name: string) => id('_comp', { name })
  let kind = (name: string) => id('_kind', { name })
  let packages: Bundle[] = pkg
    ? [{
      entity: { eid: pkg },
      _package: { name: doc.package },
      doc: { title: doc.package, body: doc.description ?? null },
    }]
    : []
  let comps: Bundle[] = []
  let kinds: Bundle[] = []
  let extensions: Bundle[] = []
  let props: Bundle[] = []
  let edges: Bundle[] = []
  let effects: Bundle[] = []
  for (let [name, s] of Object.entries(doc.$defs ?? {})) {
    if (s?.effect === true) {
      effects.push({
        entity: { eid: id('_effect', { name }) },
        _effect: { name, package: pkg, ...row(s, EFFECT, EFFECT_SHAPE) },
        doc: { title: name, body: s.description ?? null },
      })
      continue
    }
    if (s?.component !== true) continue
    let c = comp(name)
    if (!s.extends) {
      comps.push({
        entity: { eid: c },
        _comp: { name, package: pkg, ...row(s, COMP, SHAPE) },
        doc: { title: name, body: s.description ?? null },
      })
    } else {
      extensions.push({
        entity: { eid: id('_extends', { comp: c, package: pkg }) },
        _extends: { comp: c, package: pkg, status: s.status ?? null },
        doc: {
          title: `${name}+${doc.package ?? ''}`,
          body: s.description ?? null,
        },
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
  let own = Object.fromEntries(
    Object.entries(doc.$defs ?? {}).filter(([, s]) =>
      s?.component === true && !s.extends
    ),
  )
  for (let k of kindsIn([doc], own, {}).values()) {
    let from = kind(k.name)
    kinds.push({
      entity: { eid: from },
      _kind: {
        name: k.name,
        package: pkg,
        is: k.is,
        with: Object.keys(k.with).length ? k.with : null,
        prefix: k.prefix ?? null,
        examples: k.examples.length ? k.examples : null,
      },
      doc: { title: k.title ?? k.name, body: k.description ?? null },
    })
    k.before.forEach((name, ord) => {
      let to = kind(name)
      edges.push({
        entity: { eid: `$_before:${from}:${to}` },
        edge: { from, to, ord },
        _before: {},
      })
    })
  }
  return [
    ...packages,
    ...comps,
    ...kinds,
    ...effects,
    ...extensions,
    ...props,
    ...edges,
  ]
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
 * components, kinds and effects, and an `extends` entry wherever a package
 * added properties or status rungs to a component another one declares.
 * `loadVocab` and `effectsIn` of what it returns are the vocabulary the
 * bundles were projected from. It reads the rows a graph holds (`._package`,
 * `._comp`, `._kind`, `._effect`, `._extends`, `._prop`, `._before`), with
 * whatever else those entities wear. A kind that is only the component of its
 * name, in its package, is said on that component (`kind: true`, `prefix`,
 * `before`), and any other under `kinds`. An edge to an entity no `_kind`
 * names is a kind these bundles never declared, and is left out.
 */
export let fromBundles = (bundles: Bundle[]): VocabDoc[] => {
  let packages = new Map(
    bundles.filter((b) => b._package).map((b) => [
      b.entity.eid,
      String(kept(b, '_package').name),
    ]),
  )
  let packageOf = (eid: unknown) => packages.get(String(eid)) ?? ''
  let named = new Map<string, { name: string; pkg: string }>()
  let docs = new Map<string, Record<string, PropSchema>>()
  let defs = (pkg: string) => docs.get(pkg) ?? docs.set(pkg, {}).get(pkg)!
  let declared = new Map<string, Record<string, KindDecl>>()
  let kindsOf = (pkg: string) =>
    declared.get(pkg) ?? declared.set(pkg, {}).get(pkg)!
  for (let b of bundles.filter((b) => b._comp)) {
    let { name, package: at, keywords, ...cols } = kept(b, '_comp')
    let pkg = packageOf(at)
    named.set(b.entity.eid, { name: String(name), pkg })
    defs(pkg)[String(name)] = {
      component: true,
      type: 'object',
      ...keywords as object,
      ...cols,
      ...described(b),
      properties: {},
    }
  }
  for (let b of bundles.filter((b) => b._effect)) {
    let { name, package: at, keywords, ...cols } = kept(b, '_effect')
    defs(packageOf(at))[String(name)] = {
      effect: true,
      ...keywords as object,
      ...cols,
      ...described(b),
    }
  }
  // Each kind, by its row's eid: the entry its `before` is said on.
  let kinds = new Map<string, { name: string; said: PropSchema | KindDecl }>()
  for (let b of bundles.filter((b) => b._kind)) {
    let { name, package: at, is, with: has, prefix, examples } = kept(
      b,
      '_kind',
    )
    let pkg = packageOf(at)
    let n = String(name)
    let title = (b.doc as { title?: string } | null | undefined)?.title
    let entry = defs(pkg)[n] as PropSchema | undefined
    let alone = entry?.component === true && !entry.extends &&
      String(is) == n && !has && !examples &&
      described(b).description == entry.description &&
      (title ?? n) == (entry.title ?? n)
    let said: PropSchema | KindDecl = alone
      ? Object.assign(entry!, { kind: true }, prefix ? { prefix } : {})
      : kindsOf(pkg)[n] = {
        is: is as string[],
        ...has ? { with: has as KindDecl['with'] } : {},
        ...prefix ? { prefix: String(prefix) } : {},
        ...examples ? { examples: examples as KindDecl['examples'] } : {},
        ...title && title != n ? { title } : {},
        ...described(b),
      }
    kinds.set(b.entity.eid, { name: n, said })
  }
  // Each extension, its rungs in the order its entry gave them; the
  // properties it adds are `_prop` rows like any other.
  let extending = (comp: unknown, at: unknown) => {
    let home = named.get(String(comp))
    if (!home) return undefined
    return defs(packageOf(at))[home.name] ??= {
      component: true,
      extends: true,
      properties: {},
    }
  }
  for (let b of bundles.filter((b) => b._extends)) {
    let { comp, package: at, status } = kept(b, '_extends')
    let entry = extending(comp, at)
    if (!entry) continue
    Object.assign(entry, described(b), status ? { status } : {})
  }
  let ord = (b: Bundle, name: string, key: string) =>
    Number((b[name] as Record<string, unknown>)[key] ?? 0)
  let props = bundles.filter((b) => b._prop)
    .sort((a, b) => ord(a, '_prop', 'ord') - ord(b, '_prop', 'ord'))
  for (let b of props) {
    let { comp, name, ord: _, package: at, required, keywords, ...cols } = kept(
      b,
      '_prop',
    )
    let entry = extending(comp, at)
    if (!entry) continue
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
    let [kind, target] = [kinds.get(from), kinds.get(to)]
    if (!kind || !target) continue
    kind.said.before = [...kind.said.before ?? [], target.name]
  }
  for (let pkg of declared.keys()) defs(pkg)
  return [...docs].map(([pkg, $defs]) => ({
    ...(pkg ? { package: pkg } : {}),
    $defs,
    ...declared.has(pkg) ? { kinds: declared.get(pkg) } : {},
  }))
}
