#!/usr/bin/env -S deno run -A
// One-time (T-59131, D-59037): `role.state` and `role.stopped_at` leave
// @yaks/persona. Nothing has written either since the supervisor went in
// 7b4edbb8c; this clears the values the box still holds, while both are still
// declared, so the release that drops them leaves no column behind
// (@yaks/sqlite `refit` drops an undeclared column only once it is empty). The
// journal keeps what they said. Every write guards the values it read.
//
//   deno run -A bin/migrate-role-state.ts <config> [--write]

import { type Bundle, type Comp, token } from '@yaks/graph'
import { close, opened, signer } from '../packages/cli/local.ts'

let [path, flag] = Deno.args
let host = await opened(path, ['graph'], false)
let g = host.graph
let as = await signer(host, Deno.env.get('CLAUDE_CODE_SESSION_ID'))

let held = async () =>
  (await g.read('.role&*')).filter((b) =>
    (b.role as Comp).state != null || (b.role as Comp).stopped_at != null
  )

let rows = await held()
console.log(`${rows.length} roles hold a state or a stop time`)
let bundles: Bundle[] = rows.map((b) => {
  let role = b.role as Comp
  return {
    entity: { eid: b.entity.eid },
    role: { state: null, stopped_at: null },
    $was: {
      role: { state: token(role.state), stopped_at: token(role.stopped_at) },
    },
    ...as,
  }
})
if (flag == '--write') await g.apply(bundles, { trusted: true })
let left = await held()
console.log(`${left.length} left`)
await close(left.length && flag == '--write' ? 1 : 0)
