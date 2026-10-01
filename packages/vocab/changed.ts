import { typesOf } from './vocab.ts'
import type { PropSchema, VocabDoc } from './types.ts'

/** Whether two declarations speak the same type and format, ignoring prose
 * and keyword changes. Type unions are sets, not ordered lists. */
export let same = (a: PropSchema, b: PropSchema): boolean =>
  a.format == b.format &&
  typesOf(a).sort().join() == typesOf(b).sort().join()

/** The words another document drops, adds or retypes. A whole definition is
 * named `name`; a property is named `name.prop`. Components and tools share
 * this comparison, with no store or rows involved. Retyped words are also
 * additions: the new declaration plants a different type under that name. */
export let changed = (was: VocabDoc, next: VocabDoc): {
  dropped: string[]
  added: string[]
  retyped: string[]
} => {
  let mine = was.$defs ?? {}
  let theirs = next.$defs ?? {}
  let dropped = Object.keys(mine).filter((name) => !(name in theirs))
  let added: string[] = []
  let retyped: string[] = []
  for (let [name, schema] of Object.entries(theirs)) {
    let had = mine[name]
    if (!had) added.push(name)
    else if (!same(had, schema)) {
      retyped.push(name)
      added.push(name)
    }
    for (let prop of Object.keys(had?.properties ?? {})) {
      if (!(prop in (schema.properties ?? {}))) dropped.push(`${name}.${prop}`)
    }
    for (let [prop, s] of Object.entries(schema.properties ?? {})) {
      let before = had?.properties?.[prop]
      if (before && !same(before, s)) retyped.push(`${name}.${prop}`)
      if (!before || !same(before, s)) added.push(`${name}.${prop}`)
    }
  }
  return { dropped, added, retyped }
}
