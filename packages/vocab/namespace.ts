// A word's identity, and the namespace it is declared in. A vocabulary
// document carries identities in JSON Schema's own slot, `$id`, as an absolute
// URI, `urn:uuid:…`: the document's `$id` is its namespace's, each `$defs`
// entry's its component's, kind's or the like, and each property schema's its
// property's. The keys a document writes them under are labels, which may
// change while the identity stays.
//
// A `$id` of any other form (a meta-schema's URL) names no word, and a word
// with none is held by its label alone, as every word was before identities.

import type { Namespace, VocabDoc } from './types.ts'

let URN =
  /^urn:uuid:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/** The identity a `$id` gives: the UUID of a `urn:uuid:…`, lowercased, and
 * undefined for any other `$id` or none.
 *
 * ```ts
 * import { idOf } from '@yaks/vocab'
 * import { equal } from '@yaks/testing'
 *
 * let id = crypto.randomUUID()
 * equal(idOf(`urn:uuid:${id.toUpperCase()}`), id)
 * equal(idOf('https://yak.sh/vocab/meta'), undefined)
 * ```
 */
export let idOf = ($id: unknown): string | undefined =>
  typeof $id == 'string' ? URN.exec($id)?.[1].toLowerCase() : undefined

/** The namespace a document declares its words in: its `$id`'s identity and
 * the label its host wrote, or `label` where an entry says its own (a
 * component reported out of several namespaces). Undefined where neither is
 * said. */
export let namespaceOf = (
  doc: VocabDoc,
  label: string | undefined = doc.label,
): Namespace | undefined => {
  let id = idOf(doc.$id)
  if (!id && !label) return undefined
  return { ...(id ? { id } : {}), ...(label ? { label } : {}) }
}

/** Whether two namespaces are one: the same identity, or the same label. One
 * that says neither cannot be told from any other, so it is the same as all. */
let same = (a?: Namespace, b?: Namespace): boolean =>
  !a?.id && !a?.label || !b?.id && !b?.label ||
  !!a.id && a.id == b.id || !!a.label && a.label == b.label

// One declaration of a label: the entry, and the namespace that said it.
export type Declared = { schema: { $id?: string }; ns?: Namespace }

/** A word's full label: its namespace's label, a colon and its own label
 * (`yourname/trip:cost`), or its identity where its namespace has no label to
 * write. */
export let fullLabel = (
  label: string,
  ns?: Namespace,
  id?: string,
): string | undefined => ns?.label ? `${ns.label}:${label}` : id

// The names the declarations of one label are held under. One declaration is
// held under its label. Several are several words when each has an identity of
// its own and comes from a namespace of its own, and each is held under its
// full label, the name a reader in no namespace writes it by; anything else is
// the label said twice, which throws. Which two
// said it is named where both say whose they are: one namespace saying it
// twice was loaded twice, as a config naming a package twice.
export let apart = <T extends Declared>(
  what: string,
  label: string,
  all: T[],
): [string, T][] => {
  if (all.length == 1) return [[label, all[0]]]
  for (let [i, a] of all.entries()) {
    for (let b of all.slice(i + 1)) {
      let ia = idOf(a.schema.$id), ib = idOf(b.schema.$id)
      if (ia && ib && ia != ib && !same(a.ns, b.ns)) continue
      let x = a.ns?.label, y = b.ns?.label
      let by = !x || !y
        ? ''
        : x == y
        ? `, by ${x} loaded twice`
        : `, by ${x} and by ${y}`
      throw new Error(`${what} '${label}' is declared twice${by}`)
    }
  }
  return all.map((d) => [fullLabel(label, d.ns, idOf(d.schema.$id))!, d])
}

// The namespaces that declare a label, for a message: `@yaks/model and
// yourname/trip`.
export let namespaces = (all: Declared[]): string =>
  all.map((d) => d.ns?.label ?? d.ns?.id ?? 'a document').join(' and ')
