// A vocabulary described as entities, in the meta vocabulary (./vocab.json): a
// `_namespace` for the package or app a document is, a `_comp` per component
// it declares, a `_kind` per kind it declares (./kinds.ts), an `_extends` per
// component it extends (the status rungs it adds), a `_prop` per property it
// declares or extends, an `_effect` per effect it declares, and a `_before`
// edge per kind a kind sorts before, each wearing `doc` for its name and its
// description. A vocabulary is then read, searched and linked like anything
// else in a graph, and what `graph_schema` answers is a query:
//
//   ._comp ?doc                     every component, by name
//   ._prop.comp._comp.name=mail     mail's properties (`.order=_prop.ord`)
//   ._prop.ref=mail                 what refers to mail
//   ._kind.name=decision            what makes a decision
//   ._before .edge.from=<decision>  the kinds a decision sorts before
//   ._prop.namespace=<@yaks/id>     what a namespace declares and extends
//   ._effect.namespace=<@yaks/mail> the effects a namespace declares
//
// `toBundles` reads one document on its own, so a file is read on its own
// (@yaks/code reads each package's vocab.json this way). What joins two
// documents is their ids. A word's row is the word's identity, its `$id`
// (./namespace.ts): the namespace's, a component's, a property's, a kind's
// declared under `kinds`, an effect's. So a rename, which changes a label and
// keeps the `$id`, moves no row, and an `extends` entry, which carries the
// `$id` of the component it extends, lands its properties on that component's
// row without either document knowing the other. A word without a `$id` is
// where its labels derive (`labelled`), as every row was before identities.
// `fromBundles` goes back, to documents `loadVocab` takes.
//
// A keyword with a column of its own is written there, and every other one an
// entry says — another package's (`prefix`, `store`) or JSON Schema's own
// (`minLength`) — rides verbatim in `keywords`, so nothing a document says is
// lost on the way through.

import { type Kind, type KindDecl, kindsIn } from './kinds.ts'
import { metaDoc } from './meta.ts'
import { idOf } from './namespace.ts'
import type { PropSchema, VocabDoc } from './types.ts'
import type { Vocab } from './vocab.ts'

/**
 * One entity as a graph writes it: its id under `entity`, each component under
 * its own name. The structural shape of @yaks/graph's `Bundle`, declared here
 * rather than imported, since @yaks/graph imports this package.
 */
export type Bundle = {
  entity: { eid: string }
  [comp: string]: Record<string, unknown> | null | boolean | string | undefined
}

/** Where the row of a word without a `$id` is, from its labels. */
export type Labelled = {
  namespace: (label: string) => string
  comp: (label: string) => string
  kind: (label: string) => string
  effect: (label: string) => string
  /** a property, by its component's row and its label */
  prop: (comp: string, label: string) => string
  /** an extension, by the component's row and the namespace's: no word, so
   * never a `$id` of its own (its declared identity, `comp` and `namespace`) */
  extends: (comp: string, namespace: string) => string
}

/**
 * Where the rows of words without a `$id` are: `derive` (@yaks/graph
 * `derivedEid`) of the meta word and the labels, joined by `|`, as every row
 * was before identities. A namespace derives as the `_package` it was first
 * written as, so renaming that meta word moved no entity: a `_lens` and a
 * page's `$speaks` name it there (@yaks/lens `packageEid`).
 *
 * ```ts
 * import { labelled } from '@yaks/vocab'
 * let at = labelled((s) => s)
 * at.namespace('@yaks/id') // '_package|@yaks/id'
 * at.prop(at.comp('note'), 'text') // '_prop|_comp|note|text'
 * ```
 */
export let labelled = (derive: (sentence: string) => string): Labelled => {
  let of = (...parts: string[]) => derive(parts.join('|'))
  return {
    namespace: (label) => of('_package', label),
    comp: (label) => of('_comp', label),
    kind: (label) => of('_kind', label),
    effect: (label) => of('_effect', label),
    prop: (comp, label) => of('_prop', comp, label),
    extends: (comp, namespace) => of('_extends', comp, namespace),
  }
}

// The columns the meta vocabulary gives a component and a property, less the
// ones the projection fills itself rather than copying off a schema. `former`
// is a store's own record of the labels a row had (@yaks/code), which no
// document says.
let columns = (comp: string, own: string[]) =>
  Object.keys(metaDoc.$defs![comp].properties!).filter((k) => !own.includes(k))
let OWN = ['name', 'namespace', 'keywords', 'former']
let COMP = columns('_comp', OWN)
let PROP = columns('_prop', [...OWN, 'comp', 'ord', 'required'])
let EFFECT = columns('_effect', OWN)

// What a component entry says by its shape rather than by a keyword: that it
// is one, its identity, its properties, and the lists that become rows and
// edges. A component that is the kind of its own name says so in `kind`,
// `prefix` and `before`, which its `_kind` row and `_before` edges hold.
let SHAPE = [
  '$id',
  'component',
  'extends',
  'type',
  'description',
  'properties',
  'required',
  'kind',
  'prefix',
  'before',
  'label',
]

// What an effect entry says by its shape: its identity, that it is one, and
// what it does.
let EFFECT_SHAPE = ['$id', 'effect', 'description']

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

// A kind's row: its own identity where it is declared under `kinds` with one.
// A component's kind is the component's word, so its row derives from the
// component's identity, or from its label where it has none.
let kindRow = (at: Labelled, k: Kind, comp?: string) =>
  k.id && k.id != comp ? k.id : at.kind(k.id ?? k.label)

/**
 * Where each word `vocab` holds has its row, by label: its identity, else
 * where its labels derive by `derive` (`labelled`). A label `vocab` does not
 * hold derives too. What a page links a word's name to.
 *
 * ```ts
 * import { loadVocab, rowsOf } from '@yaks/vocab'
 * let id = crypto.randomUUID()
 * let at = rowsOf(
 *   loadVocab({ $defs: { note: { $id: `urn:uuid:${id}`, component: true } } }),
 *   (s) => s,
 * )
 * at.comp('note') == id // true
 * at.comp('memo') // '_comp|memo'
 * ```
 */
export let rowsOf = (
  vocab: Vocab,
  derive: (sentence: string) => string,
): Labelled => {
  let at = labelled(derive)
  let comp = (label: string) => vocab.comp(label)?.id ?? at.comp(label)
  let declared = (label: string) =>
    vocab.docs.map((d) => d.$defs?.[label]).find((s) => s?.effect === true)
  return {
    ...at,
    namespace: (label) =>
      idOf(vocab.docs.find((d) => d.label == label)?.$id) ??
        at.namespace(label),
    comp,
    kind: (label) => {
      let k = vocab.kind(label)
      return k ? kindRow(at, k, vocab.comp(k.name)?.id) : at.kind(label)
    },
    effect: (label) => idOf(declared(label)?.$id) ?? at.effect(label),
    prop: (c, label) => vocab.prop(c, label)?.id ?? at.prop(comp(c), label),
  }
}

/**
 * One document's vocabulary as bundles: a `_namespace` where the document
 * says its namespace's `$id` or `label` (its `description` the namespace's), a
 * `_comp` for each component it declares, a `_kind` for each kind it declares,
 * under `kinds` or as a component of the kind's name, an `_extends` for each
 * component it extends, a `_prop` for each property it declares or adds, a
 * `_before` edge for each kind a kind's `before` names, and an `_effect` for
 * each effect it declares. Each row is its word's `$id`, or where its labels
 * derive by `derive` (`labelled`). A component or kind the document only names
 * (`before`, an `extends` without its `$id`) is the one `vocab` holds by that
 * label, where one is given, else where the label derives. A tool, a rule or
 * any other entry that is neither a component nor an effect is left out.
 *
 * ```ts
 * import { toBundles } from '@yaks/vocab'
 * let doc = { $defs: { note: { component: true, properties: {
 *   text: { type: 'string', description: 'what it says' },
 * } } } }
 * toBundles(doc, (s) => s)[1]
 * // { entity: { eid: '_prop|_comp|note|text' },
 * //   _prop: { comp: '_comp|note', name: 'text', ord: 0, type: 'string', … },
 * //   doc: { title: 'note.text', body: 'what it says' } }
 * ```
 */
export let toBundles = (
  doc: VocabDoc,
  derive: (sentence: string) => string,
  vocab?: Vocab,
): Bundle[] => {
  let at = labelled(derive)
  let held = vocab ? rowsOf(vocab, derive) : at
  let nsId = idOf(doc.$id)
  let ns = nsId ?? (doc.label ? at.namespace(doc.label) : null)
  let defs = doc.$defs ?? {}
  // The row of a component this document extends: the `$id` its entry
  // carries, else the one `vocab` holds by its label.
  let extended = (name: string, s: PropSchema) => idOf(s.$id) ?? held.comp(name)
  let namespaces: Bundle[] = ns
    ? [{
      entity: { eid: ns },
      _namespace: { name: doc.label ?? null },
      doc: { title: doc.label ?? null, body: doc.description ?? null },
    }]
    : []
  let comps: Bundle[] = []
  let kinds: Bundle[] = []
  let extensions: Bundle[] = []
  let props: Bundle[] = []
  let edges: Bundle[] = []
  let effects: Bundle[] = []
  for (let [name, s] of Object.entries(defs)) {
    if (s?.effect === true) {
      effects.push({
        entity: { eid: idOf(s.$id) ?? at.effect(name) },
        _effect: { name, namespace: ns, ...row(s, EFFECT, EFFECT_SHAPE) },
        doc: { title: name, body: s.description ?? null },
      })
      continue
    }
    if (s?.component !== true) continue
    let c = s.extends ? extended(name, s) : idOf(s.$id) ?? at.comp(name)
    if (!s.extends) {
      comps.push({
        entity: { eid: c },
        _comp: { name, namespace: ns, ...row(s, COMP, SHAPE) },
        doc: { title: name, body: s.description ?? null },
      })
    } else {
      extensions.push({
        entity: { eid: at.extends(c, ns ?? '') },
        _extends: { comp: c, namespace: ns, status: s.status ?? null },
        doc: {
          title: `${name}+${doc.label ?? ''}`,
          body: s.description ?? null,
        },
      })
    }
    Object.entries(s.properties ?? {}).forEach(([prop, p], ord) =>
      props.push({
        entity: { eid: idOf(p.$id) ?? at.prop(c, prop) },
        _prop: {
          comp: c,
          name: prop,
          ord,
          namespace: ns,
          required: s.required?.includes(prop) || null,
          ...row(p, PROP, ['$id', 'description']),
        },
        doc: { title: `${name}.${prop}`, body: p.description ?? null },
      })
    )
  }
  let own = Object.fromEntries(
    Object.entries(defs).filter(([, s]) => s?.component === true && !s.extends),
  )
  let declared = kindsIn([doc], own, {})
  // A kind's row, by its label: this document's, else the one `vocab` holds.
  let kind = (label: string) => {
    let k = declared.get(label)
    if (k) return kindRow(at, k, idOf(own[label]?.$id))
    let held = vocab?.kind(label)
    return held ? kindRow(at, held, vocab?.comp(held.name)?.id) : at.kind(label)
  }
  for (let k of declared.values()) {
    let from = kind(k.name)
    kinds.push({
      entity: { eid: from },
      _kind: {
        name: k.name,
        namespace: ns,
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
    ...namespaces,
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

// The `$id` a row's eid gives back: an identity, never a row its labels
// derived (@yaks/graph `derivedEid` marks those version 8), so a word read
// back says the `$id` it was written with, and one without says none.
let urn = (eid: string): { $id?: string } =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-79a-f]/i.test(eid) && idOf(`urn:uuid:${eid}`)
    ? { $id: `urn:uuid:${eid}` }
    : {}

/**
 * Bundles back into documents: one per namespace, each declaring that
 * namespace's components, kinds and effects, and an `extends` entry wherever a
 * namespace added properties or status rungs to a component another one
 * declares. Each word, and each document, says its row as its `$id` where that
 * is an identity rather than where a label derived. `loadVocab` and
 * `effectsIn` of what it returns are the vocabulary the bundles were projected
 * from. It reads the rows a graph holds (`._namespace`, `._comp`, `._kind`,
 * `._effect`, `._extends`, `._prop`, `._before`), with whatever else those
 * entities wear. A kind that is only the component of its name, in its
 * namespace, is said on that component (`kind: true`, `prefix`, `before`), and
 * any other under `kinds`. An edge to an entity no `_kind` names is a kind
 * these bundles never declared, and is left out.
 */
export let fromBundles = (bundles: Bundle[]): VocabDoc[] => {
  let labels = new Map(
    bundles.filter((b) => b._namespace).map((b) => [
      b.entity.eid,
      kept(b, '_namespace').name as string | undefined,
    ]),
  )
  let nsOf = (eid: unknown) => labels.has(String(eid)) ? String(eid) : ''
  let named = new Map<string, { name: string; ns: string }>()
  let docs = new Map<string, Record<string, PropSchema>>()
  let defs = (ns: string) => docs.get(ns) ?? docs.set(ns, {}).get(ns)!
  let declared = new Map<string, Record<string, KindDecl>>()
  let kindsOf = (ns: string) =>
    declared.get(ns) ?? declared.set(ns, {}).get(ns)!
  for (let b of bundles.filter((b) => b._comp)) {
    let { name, namespace: at, keywords, former: _, ...cols } = kept(
      b,
      '_comp',
    )
    let ns = nsOf(at)
    named.set(b.entity.eid, { name: String(name), ns })
    defs(ns)[String(name)] = {
      ...urn(b.entity.eid),
      component: true,
      type: 'object',
      ...keywords as object,
      ...cols,
      ...described(b),
      properties: {},
    }
  }
  for (let b of bundles.filter((b) => b._effect)) {
    let { name, namespace: at, keywords, ...cols } = kept(b, '_effect')
    defs(nsOf(at))[String(name)] = {
      ...urn(b.entity.eid),
      effect: true,
      ...keywords as object,
      ...cols,
      ...described(b),
    }
  }
  // Each kind, by its row's eid: the entry its `before` is said on.
  let kinds = new Map<string, { name: string; said: PropSchema | KindDecl }>()
  for (let b of bundles.filter((b) => b._kind)) {
    let { name, namespace: at, is, with: has, prefix, examples } = kept(
      b,
      '_kind',
    )
    let ns = nsOf(at)
    let n = String(name)
    let title = (b.doc as { title?: string } | null | undefined)?.title
    let entry = defs(ns)[n] as PropSchema | undefined
    // A kind with an identity of its own is a word of its own.
    let alone = !urn(b.entity.eid).$id && entry?.component === true &&
      !entry.extends &&
      String(is) == n && !has && !examples &&
      described(b).description == entry.description &&
      (title ?? n) == (entry.title ?? n)
    let said: PropSchema | KindDecl = alone
      ? Object.assign(entry!, { kind: true }, prefix ? { prefix } : {})
      : kindsOf(ns)[n] = {
        ...urn(b.entity.eid),
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
  // properties it adds are `_prop` rows like any other. It carries the `$id`
  // of the component it extends.
  let extending = (comp: unknown, at: unknown) => {
    let home = named.get(String(comp))
    if (!home) return undefined
    return defs(nsOf(at))[home.name] ??= {
      ...urn(String(comp)),
      component: true,
      extends: true,
      properties: {},
    }
  }
  for (let b of bundles.filter((b) => b._extends)) {
    let { comp, namespace: at, status } = kept(b, '_extends')
    let entry = extending(comp, at)
    if (!entry) continue
    Object.assign(entry, described(b), status ? { status } : {})
  }
  let ord = (b: Bundle, name: string, key: string) =>
    Number((b[name] as Record<string, unknown>)[key] ?? 0)
  let props = bundles.filter((b) => b._prop)
    .sort((a, b) => ord(a, '_prop', 'ord') - ord(b, '_prop', 'ord'))
  for (let b of props) {
    let {
      comp,
      name,
      ord: _,
      namespace: at,
      required,
      keywords,
      former: __,
      ...cols
    } = kept(b, '_prop')
    let entry = extending(comp, at)
    if (!entry) continue
    entry.properties![String(name)] = {
      ...urn(b.entity.eid),
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
  for (let ns of declared.keys()) defs(ns)
  return [...docs].map(([ns, $defs]) => ({
    ...ns ? urn(ns) : {},
    ...labels.get(ns) ? { label: labels.get(ns) } : {},
    $defs,
    ...declared.has(ns) ? { kinds: declared.get(ns) } : {},
  }))
}
