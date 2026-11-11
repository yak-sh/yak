// What a `readers` declaration asks of a reader, for the entity wearing it.
// A floor asks it of every such entity; an object maps floors to queries, and
// an entity asks the highest floor whose query its own bundle matches, or
// nothing when it matches none: `{"editor": ".individual.status!=member"}`.
import { filter } from '@yaks/match'
import { parse } from '@yaks/query'
import type { Clause } from '@yaks/query'
import type { Bundle } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { type Floor, floor, FLOORS, isFloor } from './words.ts'

/** What a component asks of its readers: a floor, or a query for each floor
 * an entity wearing it asks when its bundle matches. */
export type Asked = Floor | Partial<Record<Floor, string>>

/** The floor an entity wearing the component asks, or none. */
export type Ask = (b: Bundle) => Floor | null

let conditional = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

/** A declared `readers` as {@link Asked}: a floor this package does not know
 * asks the most. */
export let askedOf = (said: unknown): Asked =>
  conditional(said)
    ? Object.fromEntries(
      Object.entries(said).map(([f, q]) => [floor(f), String(q)]),
    )
    : floor(said)

/** The conditions of an {@link Asked}, lowest floor first: `[floor, query]`.
 * A floor alone is one without a query. */
export let conditions = (asked: Asked): [Floor, string | null][] =>
  typeof asked == 'string'
    ? [[asked, null]]
    : FLOORS.flatMap((f) => asked[f] === undefined ? [] : [[f, asked[f]!]])

/** The highest floor `asked` can ask of a reader. */
export let top = (asked: Asked): Floor =>
  conditions(asked).at(-1)?.[0] ?? 'owner'

/** What `asked` asks of the entity whose bundle is given, its queries run in
 * memory against it. */
export let asking = (asked: Asked, vocab: Vocab | undefined): Ask => {
  if (typeof asked == 'string') return () => asked
  if (!vocab) throw new Error('a readers condition is matched against a vocab')
  let tests = conditions(asked).map(([f, q]) => [f, filter(q!, vocab)] as const)
  return (b) => tests.findLast(([, test]) => test(b))?.[0] ?? null
}

// Whether a clause tests only `name`'s own properties.
let within = (name: string, c: Clause): boolean =>
  c.kind == 'and' || c.kind == 'or'
    ? c.clauses.every((k) => within(name, k))
    : c.kind == 'pred' && c.path[0] == name && !c.where

/** The reasons a component's `readers` is no declaration: a key that is not a
 * floor, a query that does not parse, or one that tests anything but the
 * component's own properties (an entity's bundle is all that is matched). */
export let askedErrors = (name: string, said: unknown): string[] => {
  let is = `${name} is read by`
  let floors = 'readers is person, viewer, editor or owner'
  if (!conditional(said)) {
    return isFloor(said) ? [] : [`${is} "${said}" — ${floors}`]
  }
  return Object.entries(said).flatMap(([f, q]) => {
    if (!isFloor(f)) return [`${is} "${f}" — ${floors}`]
    try {
      if (typeof q == 'string' && within(name, parse(q))) return []
    } catch (e) {
      return [`${is} ${f}s where "${q}" — it does not parse: ${e}`]
    }
    return [
      `${is} ${f}s where "${q}" — it may test only ${name}'s own properties`,
    ]
  })
}
