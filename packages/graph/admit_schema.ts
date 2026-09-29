// Full JSON Schema checks for properties that ask for them. A graph composes
// this plugin when it serves app vocabularies; the ordinary vocabulary check
// remains the lightweight type boundary for every other property.

import { numberOf, type NumericConstraint } from '@yaks/vocab/constraints'
import { errorsText, toolCheck } from '@yaks/vocab/tools'
import type { Vocab } from '@yaks/vocab'
import { Refused } from './admit.ts'
import { type Bundle, type Comp, comps, dead } from './bundle.ts'
import { merged } from './gather.ts'
import { then } from './pipe.ts'
import type { Plugin, WriteHook } from './plugin.ts'

type Check = ReturnType<typeof toolCheck>

// A property's nested $ref resolves in the document that declared it. An
// extension's property belongs to the extension document, not the base one.
let checks = (vocab: Vocab): Map<string, Map<string, Check>> => {
  let out = new Map<string, Map<string, Check>>()
  for (let doc of vocab.docs) {
    for (let [comp, def] of Object.entries(doc.$defs ?? {})) {
      if (def.component !== true && def.extends !== true) continue
      for (let [prop, schema] of Object.entries(def.properties ?? {})) {
        if (schema.validate !== true) continue
        let root: Record<string, unknown> = {
          ...schema,
          $schema: doc.$schema ??
            'https://json-schema.org/draft/2020-12/schema',
          $defs: doc.$defs,
        }
        let props = out.get(comp) ?? new Map<string, Check>()
        props.set(prop, toolCheck(root))
        out.set(comp, props)
      }
    }
  }
  return out
}

let bounds = (vocab: Vocab): Map<string, NumericConstraint[]> =>
  new Map(vocab.all.flatMap((name) => {
    let said = vocab.def(name)?.constraints ?? []
    return said.length ? [[name, said]] : []
  }))

/** Validate opted-in schemas and numeric bounds on the complete proposed row.
 * Install this after other write hooks so none can rewrite a checked value. */
export let admitSchema = (vocab: Vocab): Plugin => {
  let said = checks(vocab), limited = bounds(vocab)
  if (!said.size && !limited.size) return { name: 'schema' }
  let names = new Set([...said.keys(), ...limited.keys()])
  let required = new Map([...names].map((name) => [
    name,
    vocab.def(name)?.required ?? [],
  ]))
  let check: WriteHook = (bundles, tx) => {
    let touched = new Map<string, Set<string>>()
    for (let b of bundles) {
      for (let [comp] of comps(b)) {
        if (!names.has(comp)) continue
        let held = touched.get(b.entity.eid) ?? new Set<string>()
        held.add(comp)
        touched.set(b.entity.eid, held)
      }
    }
    if (!touched.size) return bundles
    return then(tx.get([...touched.keys()], [...names]), (prior) => {
      let rows = new Map<string, Bundle>(prior.map((b) => [b.entity.eid, b]))
      let gone = new Set<string>()
      for (let b of bundles) {
        let eid = b.entity.eid
        if (!touched.has(eid)) continue
        if (dead(b)) {
          rows.delete(eid)
          gone.add(eid)
        } else if (!gone.has(eid)) {
          let was = rows.get(eid)
          rows.set(eid, merged(was && !dead(was) ? was : null, b))
        }
      }
      for (let [eid, affected] of touched) {
        let row = rows.get(eid)
        if (!row) continue
        for (let comp of affected) {
          let value = row[comp] as Comp | undefined
          if (!value) continue
          for (let prop of required.get(comp) ?? []) {
            if (value[prop] == null) {
              throw new Refused(`${comp}.${prop} is required`)
            }
          }
          for (let [prop, verify] of said.get(comp) ?? []) {
            if (value[prop] == null) continue
            let errors = verify(value[prop])
            if (errors.length) {
              throw new Refused(`${comp}.${prop}: ${errorsText(errors)}`)
            }
          }
          for (let limit of limited.get(comp) ?? []) {
            let amount: number
            try {
              amount = numberOf(limit.value, value)
            } catch (error) {
              throw new Refused(`${comp}.${limit.name}: ${error}`)
            }
            if (amount > limit.maximum) {
              throw new Refused(
                `${comp}.${limit.name}: ${limit.message} ` +
                  `(${amount} > ${limit.maximum})`,
              )
            }
          }
        }
      }
      return bundles
    })
  }
  let skip: WriteHook = (bundles) => bundles
  skip.independent = true
  return {
    name: 'schema',
    beforeWrite: (bundles) =>
      bundles.some((b) => comps(b).some(([name]) => names.has(name)))
        ? check
        : skip,
  }
}
