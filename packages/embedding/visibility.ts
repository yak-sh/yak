// An entity's vector contains all its embedded text. A reader may use it
// only when every contributing aspect is visible, including a query anchor.
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
  sourceScreen,
  table,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { OWED } from './ddl.ts'
import { allowed, type Field, pieces } from './fields.ts'

/** Owner ids whose stored vectors contain no hidden source text. A pending
 * vector is excluded while a component policy applies: after a private
 * source is removed, its old vector still holds that text until the sweep. */
export let visibleVectors = (
  vocab: Vocab,
  fields: Field[],
  visibility?: BindOpts['visibility'],
): Raw | undefined => {
  if (!visibility) return undefined
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
      not(among(col('entity', 'c'), permission(f)!)),
    ],
  )
  let id = col('id')
  return render(select({
    cols: [id],
    from: table('entity'),
    where: and(
      ...entity ? [among(id, entity)] : [],
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
export let screened = (within?: Raw | null, visible?: Raw): Raw | undefined =>
  visible && within
    ? render(select({
      cols: [col('id', 's')],
      from: from(within, 's'),
      where: among(col('id', 's'), visible),
    }))
    : visible ?? within ?? undefined
