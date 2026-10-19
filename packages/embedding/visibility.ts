// An entity's vector contains all its embedded text. A reader may use it
// only when every contributing aspect is visible, including a query anchor.
//
// A screen here admits nearly every entity in the graph, so it is only ever
// asked about one id at a time (./native.ts `admitted`), never read whole:
// `id in (screen)` makes SQLite list every visible entity first, seconds on a
// graph of millions, while a correlated test reaches each id by its key.
import {
  among,
  and,
  type BindOpts,
  col,
  from,
  not,
  type Raw,
  render,
  select,
  type Selection,
  sourceScreen,
  table,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { OWED } from './ddl.ts'
import { allowed, type Field, pieces } from './fields.ts'
import { admitted } from './native.ts'

/** Owner ids whose stored vectors contain no hidden source text. A pending
 * vector is excluded while a component policy applies: after a private
 * source is removed, its old vector still holds that text until the sweep. */
export let visibleVectors = (
  vocab: Vocab,
  fields: Field[],
  visibility?: BindOpts['visibility'],
): Raw | undefined => {
  if (
    !visibility ||
    !visibility.entity && !Object.keys(visibility.components ?? {}).length
  ) return undefined
  let opts = { visibility }
  let entity = sourceScreen(vocab, opts)
  let restricted = fields.filter((f) =>
    visibility.components?.[f.comp] ||
    f.on && visibility.components?.[f.on]
  )
  let scopes = new Map<string, Raw | null>()
  let permission = (f: Field) => {
    let comps = [f.comp, ...f.on ? [f.on] : []]
    let key = JSON.stringify(comps)
    if (!scopes.has(key)) {
      scopes.set(
        key,
        sourceScreen(vocab, {
          visibility: { components: visibility.components },
        }, comps),
      )
    }
    return scopes.get(key)
  }
  let hidden = pieces(
    restricted.filter(permission),
    undefined,
    undefined,
    (f) => [
      ...allowed(f),
      not(admitted(permission(f)!, col('entity', 'c'))),
    ],
  )
  if (!restricted.length && !Object.keys(visibility.components ?? {}).length) {
    return entity ?? undefined
  }
  let id = col('id', 'v')
  return render(select({
    cols: [id],
    from: table('entity', 'v'),
    where: and(
      ...entity ? [admitted(entity, id)] : [],
      ...hidden.map((q) =>
        not(among(
          id,
          select({
            cols: [col('owner', 'h')],
            from: from(q, 'h'),
          }),
        ))
      ),
      ...Object.keys(visibility.components ?? {}).length
        ? [not(among(id, select({ cols: [col('owner')], from: table(OWED) })))]
        : [],
    ),
  }))
}

/** Combine independent owner selections before a ranking is cut. */
export let screened = (
  within?: Selection | null,
  visible?: Selection,
): Selection | undefined =>
  visible && within
    ? {
      ...render(select({
        cols: [col('id', 'w')],
        from: from(within, 'w'),
        where: admitted(visible, col('id', 'w')),
      })),
      probe: (owner) => and(admitted(within, owner), admitted(visible, owner)),
    }
    : visible ?? within ?? undefined
