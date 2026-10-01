#!/usr/bin/env -S deno run -A
// One-time (T-61728): a build and an output are found by a key, not by an eid
// derived from what made them. Each build gains its `build_of` key and each
// output its `output_of` key, at the eid it already has, so nothing is rebuilt
// and nothing moves. A link output is found by its own ends and gains none. The
// platform's stores get the same from the store mover (workers/yak/mover.ts).
//
//   deno run -A bin/migrate-builder-keys.ts <config> [--write]

import type { Bundle, Comp } from '@yaks/graph'
import { EDGE } from '@yaks/edge'
import { keyed } from '@yaks/key'
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

// What each row's key says, for every row that has none yet.
let owed = async (): Promise<[string, string, string][]> => {
  let have = new Set(
    [
      ...await g.read(`.${BUILD_OF}&?key`),
      ...await g.read(`.${OUTPUT_OF}&?key`),
    ].map((k) => str(of(k.key).of)),
  )
  let builds = (await g.read('.build&?build'))
    .filter((b) => !have.has(b.entity.eid))
    .map((b): [string, string, string] => {
      let c = of(b.build)
      return [
        BUILD_OF,
        b.entity.eid,
        buildOf(str(c.builder), str(c.match), str(c.variant || 'main')),
      ]
    })
  let outputs = (await g.read(`.built&!${EDGE}&?built`))
    .filter((b) => of(b.built).slot && !have.has(b.entity.eid))
    .map((b): [string, string, string] => [
      OUTPUT_OF,
      b.entity.eid,
      outputOf(str(of(b.built).build), str(of(b.built).slot)),
    ])
  return [...builds, ...outputs]
}

let rows = await owed()
let twice = rows.filter(([kind, , value], i) =>
  rows.findIndex(([k, , v]) => k == kind && v == value) < i
)
console.log(
  `${rows.filter(([k]) => k == BUILD_OF).length} builds and ` +
    `${rows.filter(([k]) => k == OUTPUT_OF).length} outputs owe a key; ` +
    `${twice.length} values stated twice`,
)
for (let [kind, eid, value] of twice) console.log(`  ${kind} ${value} ${eid}`)
if (flag == '--write' && !twice.length) {
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
