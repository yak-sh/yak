// Scalar reads carry property paths rather than bundles. Mask the same secret
// value through projections and references, and combine redacted groups.
import type { Bundle, Row } from '@yaks/graph'
import type { Query } from '@yaks/query/core'
import type { Vocab } from '@yaks/vocab'

let concealed = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(concealed)
  if (!v || typeof v != 'object' || v instanceof Uint8Array) return v
  return Object.fromEntries(
    Object.entries(v).map(([k, value]) => {
      if (
        k == 'secret' && value && typeof value == 'object' && 'value' in value
      ) {
        return [k, {
          ...value,
          value: value.value == null ? value.value : '[set]',
        }]
      }
      return [k, concealed(value)]
    }),
  )
}

export let concealedBundles = (bundles: Bundle[]): Bundle[] =>
  concealed(bundles) as Bundle[]

let privatePath = (vocab: Vocab, path: string[]) => {
  let leaf = vocab.aim(path.join('.')).at(-1)
  return leaf?.comp == 'secret' && leaf.prop == 'value'
}

export let concealedRows = (vocab: Vocab, query: Query, rows: Row[]): Row[] => {
  rows = concealed(rows) as Row[]
  let group = query.clauses.find((c) =>
    c.kind == 'distinct' || c.kind == 'tally'
  )
  if (group && privatePath(vocab, group.path)) {
    if (!rows.length) return rows
    return [{
      value: '[set]',
      ...group.kind == 'tally'
        ? { n: rows.reduce((n, row) => n + Number(row.n), 0) }
        : {},
    }]
  }
  let fields = query.clauses.find((c) => c.kind == 'fields')
  let hidden = fields?.fields.filter((f) => privatePath(vocab, f.path))
    .map((f) => f.path.join('.')) ?? []
  return !hidden.length ? rows : rows.map((row) => ({
    ...row,
    ...Object.fromEntries(
      hidden.filter((k) => row[k] != null).map((k) => [k, '[set]']),
    ),
  }))
}
