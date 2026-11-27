// Adopt existing attempt keys without changing them or scheduling work. Input
// fingerprints start at the cutover baseline; old calls did not freeze whole
// input rows or the tool revision, so their definition remains unknown. It
// runs inside a write's transaction, so over a synchronous store it answers
// synchronously (./steps.ts): a Durable Object's commits when the body
// returns.

import { line } from '@yaks/query'
import type { Bundle, Comp, ReadTx } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import type { Vocab } from '@yaks/vocab'
import { selected } from './build.ts'
import { BUILD_OF, buildOf } from './key.ts'
import { held } from '@yaks/key'
import { definitionKey, inputKey } from './key.ts'
import { step, steps } from './steps.ts'

export let preserve = (
  tx: ReadTx,
  builder: Bundle,
  vocab: Vocab,
): Bundle[] | Promise<Bundle[]> =>
  steps(function* () {
    let definition = builder.builder as Comp
    let [tool] = yield* step(tx.get([String(definition.to)]))
    if (!tool?.tool) return []
    let writes: Bundle[] = []
    let latest = definitionKey(builder, tool)
    if (definition.definition != latest) {
      writes.push({
        entity: builder.entity,
        builder: { definition: latest },
      })
    }
    let old = yield* step(tx.read(
      line`.build.builder=${builder.entity.eid}&.build.key&!build.inputs&*`,
    ))
    let missing = old.filter((row) => {
      let b = row.build as Comp
      return b.key != null && b.inputs == null
    })
    if (!missing.length) return writes
    let chosen = yield* step(selected(tx, builder, vocab))
    let owners = yield* step(held(
      tx,
      BUILD_OF,
      chosen.flatMap(({ binding }) =>
        missing.map((row) =>
          buildOf(
            builder.entity.eid,
            JSON.stringify(binding.entities),
            String((row.build as Comp).variant),
          )
        )
      ),
    ))
    let have = new Map(missing.map((row) => [row.entity.eid, row]))
    for (let { binding } of chosen) {
      for (
        let variant of new Set(
          missing.map((row) => String((row.build as Comp).variant)),
        )
      ) {
        let eid = owners.get(
          buildOf(
            builder.entity.eid,
            JSON.stringify(binding.entities),
            variant,
          ),
        )
        let row = eid && have.get(eid)
        if (!row) continue
        let b = row.build as Comp
        writes.push({
          entity: row.entity,
          build: { inputs: inputKey(binding) },
          $was: { build: { key: token(b.key), inputs: token(b.inputs) } },
        })
      }
    }
    return writes
  })
