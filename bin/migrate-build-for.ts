#!/usr/bin/env -S deno run -A
// One-time (T-61625): a build names the entity it was built for, `build.for`,
// the first entity of the outer binding its `match` holds. A build started
// before the property existed names none; this gives each one it, and moves
// no key, call or output. A build whose binding holds no entity (a builder with
// no query) keeps none. The platform's stores get the same from the store
// mover (workers/yak/mover.ts).
//
//   deno run -A bin/migrate-build-for.ts <config> [--write]

import type { Bundle, Comp } from '@yaks/graph'
import { close, opened, signer } from '../packages/cli/local.ts'

let [path, flag] = Deno.args
let host = await opened(path, ['graph'], false)
let g = host.graph
let as = await signer(host, Deno.env.get('CLAUDE_CODE_SESSION_ID'))

let first = (b: Bundle): string | undefined =>
  (JSON.parse(String((b.build as Comp).match)) as (string | null)[])
    .find((eid) => eid != null) ?? undefined
let owed = async () =>
  (await g.read('.build&!build.for&?build')).filter((b) => first(b))

let rows = await owed()
console.log(`${rows.length} builds name no entity they were built for`)
if (flag == '--write') {
  for (let i = 0; i < rows.length; i += 500) {
    await g.apply(
      rows.slice(i, i + 500).map((b): Bundle => ({
        entity: { eid: b.entity.eid },
        build: { for: first(b) },
        ...as,
      })),
      { trusted: true },
    )
  }
}
let left = await owed()
console.log(`${rows.length - left.length} given one; ${left.length} left`)
await close(left.length && flag == '--write' ? 1 : 0)
