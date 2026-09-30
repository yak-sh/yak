#!/usr/bin/env -S deno run -A
// One-time (T-59132, D-59037): `output.phase` leaves @yaks/tools. It held
// OpenAI's Responses message phase (`commentary`, `final_answer`), and its one
// writer, the src/ fleet server, went in 34bf0a24a. This clears the values the
// box still holds, while the property is still declared, so the release that
// drops it leaves no column behind (@yaks/sqlite `refit` drops an undeclared
// column only once it is empty). Every write guards the value it read.
//
//   deno run -A bin/migrate-output-phase.ts <config> [--write]

import { type Bundle, type Comp, token } from '@yaks/graph'
import { close, opened, signer } from '../packages/cli/local.ts'

let [path, flag] = Deno.args
let host = await opened(path, ['graph'], false)
let g = host.graph
let as = await signer(host, Deno.env.get('CLAUDE_CODE_SESSION_ID'))

let held = async () => await g.read('.output.phase')

let rows = await held()
let counts: Record<string, number> = {}
for (let b of rows) {
  let phase = String((b.output as Comp).phase)
  counts[phase] = (counts[phase] ?? 0) + 1
}
console.log(`${rows.length} outputs hold a phase`, counts)
let bundles: Bundle[] = rows.map((b) => ({
  entity: { eid: b.entity.eid },
  output: { phase: null },
  $was: { output: { phase: token((b.output as Comp).phase) } },
  ...as,
}))
if (flag == '--write') {
  for (let i = 0; i < bundles.length; i += 200) {
    await g.apply(bundles.slice(i, i + 200))
  }
}
let left = await held()
console.log(`${left.length} left`)
await close(left.length && flag == '--write' ? 1 : 0)
