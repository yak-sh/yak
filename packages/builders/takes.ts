// Restore retained-take locators and frozen-binding provenance without making
// content, changing attempt keys or touching the calls that already paid for it.

import { type Binding, type Bundle, type Comp, token } from '@yaks/graph'
import { keyed, keyEid } from '@yaks/key'
import { OUTPUT_OF, outputOf } from './build.ts'
import { inputKey } from './key.ts'

let comp = (row: Bundle | undefined, name: string): Comp | undefined =>
  row?.[name] as Comp | undefined

let frozen = (call: Bundle | undefined): string | undefined => {
  let args = comp(call, 'call')?.args as { binding?: Binding } | undefined
  return args?.binding ? inputKey(args.binding) : undefined
}

/** Adopt the existing call's binding, keeping its opaque attempt key. */
export let frozenMove = (row: Bundle, call?: Bundle): Bundle[] => {
  let build = comp(row, 'build')
  if (!build?.call || String(build.inputs).startsWith('binding:')) return []
  let inputs = frozen(call)
  if (!inputs) {
    throw new Error(`build ${row.entity.eid} has no frozen binding`)
  }
  return [{
    entity: row.entity,
    build: { inputs },
    $was: {
      build: {
        inputs: token(build.inputs),
        call: token(build.call),
        key: token(build.key),
      },
    },
  }]
}

/** One output converted using its build, producing call, both locators and
 * the same build's chosen rows. Evidence is plain data, shared by a copied box
 * graph and the synchronous hosted mover. Output ids and all content stay put.
 */
export let takeMove = (row: Bundle, evidence: Bundle[]): Bundle[] => {
  let made = comp(row, 'built')
  if (!made) return []
  if (!made.call || !made.build || !made.slot) {
    throw new Error(
      `output ${row.entity.eid} has no producing call, build or slot`,
    )
  }
  let rows = new Map(evidence.map((r) => [r.entity.eid, r]))
  let run = comp(rows.get(String(made.build)), 'build')
  let inputs = frozen(rows.get(String(made.call)))
  if (!inputs && String(made.inputs).startsWith('binding:')) {
    inputs = String(made.inputs)
  }
  if (!inputs) {
    throw new Error(`output ${row.entity.eid} has no frozen binding`)
  }
  let old = `${made.build}/${made.slot}`
  let value = outputOf(String(made.build), String(made.slot), String(made.call))
  let oldRow = rows.get(keyEid(OUTPUT_OF, old))
  let oldKey = comp(oldRow, 'key')
  let takeKey = comp(rows.get(keyEid(OUTPUT_OF, value)), 'key')
  let held = evidence.some((r) => {
    let b = comp(r, 'built')
    return r.chosen && b?.build == made.build && b?.slot == made.slot
  })
  // Preserve a person's choice. Where the replacing writer left no mark,
  // keep its served slot (also while a reroll is pending or a binding absent).
  let chosen = !row.chosen && !held &&
    (oldKey?.of == row.entity.eid ||
      oldKey?.of == null && run?.call == made.call &&
        run?.key != null && made.key == run.key)
  let writes: Bundle[] = []
  if (oldKey?.of == row.entity.eid) {
    writes.push({
      entity: oldRow!.entity,
      key: null,
      output_of: null,
      $was: { key: { of: token(oldKey.of), value: token(oldKey.value) } },
    })
  }
  if (inputs != made.inputs || chosen) {
    writes.push({
      entity: row.entity,
      ...inputs != made.inputs ? { built: { inputs } } : {},
      ...chosen ? { chosen: {} } : {},
      $was: {
        built: Object.fromEntries(
          ['build', 'slot', 'call', 'key', 'inputs'].map((
            p,
          ) => [p, token(made[p])]),
        ),
      },
    })
  }
  if (takeKey?.of != row.entity.eid) {
    writes.push(keyed(OUTPUT_OF, row.entity.eid, value))
  }
  return writes
}
