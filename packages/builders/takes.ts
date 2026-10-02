// Convert one legacy output locator to its producing call, preserving its eid,
// content and served choice. The store mover can run this synchronously.

import { type Bundle, type Comp, token, type Tx } from '@yaks/graph'
import { keyed, keyEid, unkeyed } from '@yaks/key'
import { BUILT, OUTPUT_OF, outputOf } from './build.ts'

export let takePatch = (
  row: Bundle,
  run: Bundle | undefined,
  call: Bundle | undefined,
  locator: Bundle | undefined,
): Bundle[] => {
  let made = row[BUILT] as Comp
  if (made.inputs != null) return []
  if (!made.call || !made.slot || !made.build) {
    throw new Error(
      `output ${row.entity.eid} has no producing call, build or slot`,
    )
  }
  let b = run?.build as Comp | undefined
  let args = (call?.call as Comp | undefined)?.args as Comp | undefined
  let old = `${made.build}/${made.slot}`
  return [
    ...(locator?.key as Comp | undefined)?.of == row.entity.eid
      ? [{
        ...unkeyed(OUTPUT_OF, old),
        $was: { key: { of: token(row.entity.eid) } },
      }]
      : [],
    {
      entity: row.entity,
      built: { inputs: args?.inputs ?? b?.inputs ?? String(made.key) },
      // Keep the served choice, also for a vanished binding that may return.
      chosen: b?.key != null && made.key == b.key ? {} : null,
      $was: { built: { call: token(made.call), inputs: token(made.inputs) } },
    },
    keyed(
      OUTPUT_OF,
      row.entity.eid,
      outputOf(String(made.build), String(made.slot), String(made.call)),
    ),
  ]
}

export let takes = async (tx: Tx, builder: Bundle): Promise<Bundle[]> => {
  let rows = await tx.read(
    `.built.build.build.builder=${builder.entity.eid}&.built.call&.built.slot&!built.inputs&*`,
  )
  let writes: Bundle[] = []
  for (let row of rows) {
    let made = row[BUILT] as Comp
    let [run, call, locator] = await tx.get([
      String(made.build),
      String(made.call),
      keyEid(OUTPUT_OF, `${made.build}/${made.slot}`),
    ])
    writes.push(...takePatch(row, run, call, locator))
  }
  return writes
}
