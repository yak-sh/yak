import { same } from '@yaks/fp'
import type { PropSchema } from './types.ts'
import type { Vocab } from './vocab.ts'

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
      same(was.comp(name)?.ladder, next.comp(name)?.ladder) &&
      was.comp(name)?.package === next.comp(name)?.package
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
