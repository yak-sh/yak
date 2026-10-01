#!/usr/bin/env -S deno run -A
// One-time (T-61728): a build and an output are found by a key, not by an eid
// derived from what made them. Each build gains its `build_of` key and each
// output its `output_of` key, at the eid it already has, so nothing is rebuilt
// and nothing moves. Link outputs keep their ends-derived eid and gain keys
// too. The platform's stores get the same from the store mover (workers/yak/mover.ts).
//
//   deno run -A bin/migrate-builder-keys.ts <config> [--write]

import type { Bundle, Comp } from '@yaks/graph'
import { held, keyed } from '@yaks/key'
import {
  BUILD_OF,
  buildOf,
  OUTPUT_OF,
  outputOf,
} from '../packages/builders/build.ts'
import { close, opened, signer } from '../packages/cli/local.ts'

let [path, flag] = Deno.args
let host = await opened(path, ['graph'], false)
let g = host.graph
let as = await signer(host, Deno.env.get('CLAUDE_CODE_SESSION_ID'))

let str = (v: unknown) => v == null ? '' : String(v)
let of = (c: unknown) => c as Comp
let required = (
  comp: Comp,
  prop: string,
  eid: string,
  name: string,
): string => {
  let value = comp[prop]
  if (typeof value != 'string' || !value.trim()) {
    let recovery = name == 'built' && prop == 'slot'
      ? 'slot'
      : `${name}.${prop}`
    throw new Error(
      `${eid} needs ${recovery} recovery: ${name}.${prop} is missing, empty or invalid`,
    )
  }
  return value
}

// Check every value, not just owners with no key of either kind. A different
// kind/value on an owner must never make this migration skip its owed key.
let owed = async (): Promise<[string, string, string][]> => {
  let builds = (await g.read('.build'))
    .map((b): [string, string, string] => {
      let c = of(b.build)
      let builder = required(c, 'builder', b.entity.eid, 'build')
      let match = required(c, 'match', b.entity.eid, 'build')
      let tuple: unknown
      try {
        tuple = JSON.parse(match)
      } catch {
        throw new Error(
          `${b.entity.eid} needs build.match recovery: invalid JSON`,
        )
      }
      if (
        !Array.isArray(tuple) ||
        !tuple.every((eid) => eid === null || (typeof eid == 'string' && !!eid))
      ) {
        throw new Error(
          `${b.entity.eid} needs build.match recovery: expected an entity-ID tuple`,
        )
      }
      return [
        BUILD_OF,
        b.entity.eid,
        buildOf(builder, match, str(c.variant || 'main')),
      ]
    })
  let outputs = (await g.read('.built'))
    .map((b): [string, string, string] => {
      let c = of(b.built)
      let slot = required(c, 'slot', b.entity.eid, 'built')
      let build = required(c, 'build', b.entity.eid, 'built')
      return [OUTPUT_OF, b.entity.eid, outputOf(build, slot)]
    })
  let rows = [...builds, ...outputs]
  let owners = new Map<string, string>()
  for (let [kind, eid, value] of rows) {
    let name = JSON.stringify([kind, value])
    let before = owners.get(name)
    if (before && before != eid) {
      throw new Error(`${kind} ${value} is stated by both ${before} and ${eid}`)
    }
    owners.set(name, eid)
  }
  let have = new Map([
    [BUILD_OF, await held(g, BUILD_OF, builds.map(([, , v]) => v))],
    [OUTPUT_OF, await held(g, OUTPUT_OF, outputs.map(([, , v]) => v))],
  ])
  return rows.filter(([kind, eid, value]) => {
    let owner = have.get(kind)?.get(value)
    if (owner && owner != eid) {
      throw new Error(`${kind} ${value} is held by ${owner}, not ${eid}`)
    }
    return !owner
  })
}

let rows = await owed()
console.log(
  `${rows.filter(([k]) => k == BUILD_OF).length} builds and ` +
    `${rows.filter(([k]) => k == OUTPUT_OF).length} outputs owe a key; ` +
    '0 values stated twice',
)
if (flag == '--write') {
  for (let i = 0; i < rows.length; i += 500) {
    await g.apply(
      rows.slice(i, i + 500).map(([kind, eid, value]): Bundle => ({
        ...keyed(kind, eid, value),
        ...as,
      })),
      { trusted: true },
    )
  }
}
let left = await owed()
console.log(`${rows.length - left.length} keyed; ${left.length} left`)
await close(left.length && flag == '--write' ? 1 : 0)
