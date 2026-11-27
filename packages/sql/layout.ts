// The names that vocabulary words give storage, including related relations
// an adapter declares with the same columns and additional layout columns.
import type { Vocab } from '@yaks/vocab'

export type Related = {
  name: string
  comp: string
  prefix?: string
  suffix?: string
  columns?: readonly string[]
}

let relations = new WeakMap<Vocab, ReadonlyMap<string, Related>>()
let origins = new WeakMap<Vocab, Vocab>()

/** The vocabulary whose logical words a storage layout carries. */
export let logicalVocab = (v: Vocab): Vocab => origins.get(v) ?? v

export let relating = (v: Vocab, names: readonly Related[]): Vocab => {
  let layout = { ...v }
  relations.set(layout, new Map(names.map((r) => [r.name, r])))
  origins.set(layout, logicalVocab(v))
  return layout
}

export let related = (v: Vocab, name: string): Related | undefined =>
  relations.get(v)?.get(name)

export let relatedNames = (v: Vocab): Iterable<string> =>
  relations.get(v)?.keys() ?? []

/** The physical name of a table or column. Owner and layout columns keep
 * their reserved names. A property labeled `entity` is addressed as
 * `$entity` in statements so it stays distinct from its owner column. */
export let stored = (v: Vocab, name: string, column?: string): string => {
  let relation = related(v, name)
  let comp = relation?.comp ?? name
  if (!v.comp(comp)) return column ?? name
  if (column == null) {
    return (relation?.prefix ?? '') + v.stored(comp) + (relation?.suffix ?? '')
  }
  let prop = column == '$entity' ? 'entity' : column
  if (
    column == 'entity' || relation?.columns?.includes(column) ||
    v.prop(comp, prop)?.computed !== false
  ) return column
  let at = v.stored(comp, prop)
  return at == prop ? column : at
}

// While a file is behind its vocabulary, its missing columns read as absent
// from the same relations. The schema writer still uses the full layout.
let partial = new WeakMap<
  Vocab,
  { full: Vocab; missing: ReadonlySet<string> }
>()

export let withoutColumns = (v: Vocab, missing: readonly string[]): Vocab => {
  if (!missing.length) return v
  let layout = { ...v }
  let more = relations.get(v)
  if (more) relations.set(layout, more)
  partial.set(layout, { full: v, missing: new Set(missing) })
  origins.set(layout, logicalVocab(v))
  return layout
}

export let stoodColumn = (v: Vocab, comp: string, column: string): boolean =>
  !partial.get(v)?.missing.has(
    `${comp}.${column == '$entity' ? 'entity' : column}`,
  )

export let fullLayout = (v: Vocab): Vocab => partial.get(v)?.full ?? v
