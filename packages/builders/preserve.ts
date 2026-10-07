// Adopt existing attempt keys without changing them or scheduling work. Input
// fingerprints start at the cutover baseline; old calls did not freeze whole
// input rows or the tool revision, so their definition remains unknown.

import { type Bundle, type Comp, type ReadTx, token } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { BUILD_OF, buildOf, selected } from './build.ts'
import { held } from '@yaks/key'
import { definitionKey, inputKey } from './key.ts'

export let preserve = async (
  tx: ReadTx,
  builder: Bundle,
  vocab: Vocab,
): Promise<Bundle[]> => {
  let definition = builder.builder as Comp
  let [tool] = await tx.get([String(definition.to)])
  if (!tool?.tool) return []
  let writes: Bundle[] = []
  let latest = definitionKey(builder, tool)
  if (definition.definition != latest) {
    writes.push({
      entity: builder.entity,
      builder: { definition: latest },
    })
  }
  let old = await tx.read(
    `.build.builder=${builder.entity.eid}&.build.key&!build.inputs&*`,
  )
  let missing = old.filter((row) => {
    let b = row.build as Comp
    return b.key != null && b.inputs == null
  })
  if (!missing.length) return writes
  let chosen = await selected(tx, builder, vocab)
  let owners = await held(
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
  )
  let have = new Map(missing.map((row) => [row.entity.eid, row]))
  for (let { binding } of chosen) {
    for (
      let variant of new Set(
        missing.map((row) => String((row.build as Comp).variant)),
      )
    ) {
      let eid = owners.get(
        buildOf(builder.entity.eid, JSON.stringify(binding.entities), variant),
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
}
