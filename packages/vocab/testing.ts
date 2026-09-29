// Test fixtures (not published — see deno.json): everything a loaded
// vocabulary says, as one plain value, so two vocabularies loaded from
// different documents compare with one `assertEquals`.

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js'
import { metaSchema } from './meta.ts'
import type { Vocab } from './vocab.ts'

// A value as JSON holds it: an absent key and an `undefined` one are the same.
let plain = <T>(x: T): T => JSON.parse(JSON.stringify(x ?? null))

/** What a vocabulary says about each component: its facts, its properties in
 * order, its identity and indexes, and its schema as declared. A `required`
 * list is a set, a component's `type` is always `object`, and no `properties`
 * declares none, so those are compared as what they mean. */
export let facts = (v: Vocab) =>
  plain({
    all: v.all,
    kinds: v.kinds,
    comps: v.all.map((n) => {
      let { type: _, required, ...def } = v.def(n)!
      return {
        info: v.comp(n),
        props: v.props(n).map((p) => v.prop(n, p)),
        identity: v.identity(n),
        indexes: v.indexes(n),
        def: {
          ...def,
          properties: def.properties ?? {},
          required: required && [...required].sort(),
        },
      }
    }),
  })

let compiled: { ajv: Ajv2020; check: ValidateFunction } | undefined

/** The meta-schema as a document author uses it: ajv over `metaSchema`,
 * compiled once for every test that asks. */
export let meta = () => {
  if (compiled) return compiled
  let ajv = new Ajv2020({ strict: false, allErrors: true })
  return compiled = { ajv, check: ajv.compile(metaSchema) }
}
