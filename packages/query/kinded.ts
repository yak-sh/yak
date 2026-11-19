// A kind named where a component goes. The kinds index an agent is given
// lists each kind by name (`- app: app{slug} doc{title}`), and a kind is often
// a name no component has, so `.app` is what the agent writes for "the apps".
import type { Clause } from './ast.ts'
import { map } from './map.ts'

/** What `kinded` asks of a vocabulary. */
export type Kinds = {
  comp: (name: string) => unknown
  assoc: (name: string) => unknown
  kind: (name: string) => { is: string[] } | undefined
}

/**
 * A query with each presence test of a kind's name, where no component or
 * reverse association has that name, read as the presence of every component
 * the kind is: `.app` is the entities wearing what makes an app, as `.task`
 * is the entities wearing a task, and `?app` asks for those components. Anything else is unchanged, and the query
 * comes back as it was when nothing in it names a kind.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { kinded, parse } from '@yaks/query'
 *
 * let v = {
 *   comp: (n: string) => ['seat', 'venue', 'doc'].includes(n) || undefined,
 *   assoc: () => undefined,
 *   kind: (n: string) => n == 'booking' ? { is: ['seat', 'venue'] } : undefined,
 * }
 * assertEquals(kinded(v, parse('.booking ?doc')), parse('.seat .venue ?doc'))
 * assertEquals(kinded(v, parse('.seat')), parse('.seat'))
 * ```
 */
export let kinded = <C extends Clause>(v: Kinds, c: C): C => {
  let made = new WeakSet<Clause>()
  return map(c, (c) => {
    // A conjunction holds the kind's components beside its other clauses, so
    // `.app ?doc` reads as `.app_part ?doc` and not as a group.
    if (c.kind == 'and' && c.clauses.some((x) => made.has(x))) {
      return {
        ...c,
        clauses: c.clauses.flatMap((x) =>
          made.has(x) && x.kind == 'and' ? x.clauses : [x]
        ),
      }
    }
    if (
      c.kind != 'pred' || c.path.length != 1 || c.op != '!' && c.op != '?' ||
      c.value != null || c.not || c.where
    ) return c
    let [name] = c.path
    let k = !v.comp(name) && !v.assoc(name) ? v.kind(name) : undefined
    if (!k?.is.length) return c
    let out: Clause = {
      kind: 'and',
      clauses: k.is.map((comp) => ({ ...c, path: [comp] })),
    }
    made.add(out)
    return out
  }) as C
}
