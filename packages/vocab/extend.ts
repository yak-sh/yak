import { same } from '@yaks/fp'
import type { PropSchema } from './types.ts'
import type { Vocab } from './vocab.ts'

let meaning = (vocab: Vocab, name: string) => {
  let comp = vocab.comp(name)
  return comp && {
    ...comp,
    writable: [...comp.writable].sort(),
    stamped: [...comp.stamped].sort(),
    identity: vocab.identity(name),
    properties: Object.fromEntries(
      vocab.props(name).map((p) => [p, vocab.prop(name, p)]),
    ),
  }
}

let declarations = (vocab: Vocab): Map<string, PropSchema[]> => {
  let found = new Map<string, PropSchema[]>()
  for (let doc of vocab.docs) {
    for (let [name, schema] of Object.entries(doc.$defs ?? {})) {
      if (schema.component === true) continue
      let held = found.get(name) ?? []
      held.push(schema)
      found.set(name, held)
    }
  }
  return found
}

/** Whether `next` only adds words: existing components, declarations and
 * registered keywords keep their definitions. Object key order is immaterial;
 * list order, including status precedence, stays part of the contract. */
export let extendsVocab = (was: Vocab, next: Vocab): boolean => {
  if (was === next) return true
  if (
    !was.all.every((name) =>
      same(was.def(name), next.def(name)) &&
      same(meaning(was, name), meaning(next, name))
    )
  ) return false
  if (!was.keywords.every((k) => next.keywords.some((n) => same(k, n)))) {
    return false
  }
  let more = declarations(next)
  return [...declarations(was)].every(([name, schemas]) => {
    let added = more.get(name)
    return added?.length === schemas.length &&
      schemas.every((s) => added.some((n) => same(s, n)))
  })
}
