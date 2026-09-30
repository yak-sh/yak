#!/usr/bin/env -S deno run -A
// One-time (T-59133, D-59037): `venture.phase` keeps only the stages in use —
// building, launching, live — and `shuttered` becomes the kernel's
// `archived{at, by, via}` mark. This runs while `shuttered` is still in the
// enum, so the release that narrows it finds no row its check would refuse
// (@yaks/sqlite `refit` rebuilds the table and copies every row back).
//
// A shuttered venture loses its phase and wears `archived`. One that already
// wears it keeps its own; one that does not takes the time, author and door of
// its `created`, the earliest this graph knew it shuttered (both were imported
// shuttered, before the journal). Any other stage outside the three is
// reported and stops the run. Every write guards the phase it read.
//
//   deno run -A bin/migrate-venture-phase.ts <config> [--write]

import { type Bundle, type Comp, token } from '@yaks/graph'
import { close, opened, signer } from '../packages/cli/local.ts'

let KEPT = ['building', 'launching', 'live']

let [path, flag] = Deno.args
let host = await opened(path, ['graph'], false)
let g = host.graph
let as = await signer(host, Deno.env.get('CLAUDE_CODE_SESSION_ID'))

let phaseOf = (b: Bundle) => (b.venture as Comp).phase as string | null
let off = async () =>
  (await g.read('.venture&*')).filter((b) => {
    let phase = phaseOf(b)
    return phase != null && !KEPT.includes(phase)
  })

let rows = await off()
let other = rows.filter((b) => phaseOf(b) != 'shuttered')
for (let b of rows) {
  console.log(
    b.entity.eid,
    phaseOf(b),
    b.archived ? 'archived' : 'not archived',
  )
}
if (other.length) {
  console.log(`${other.length} ventures sit at a stage with no mapping`)
  await close(1)
  Deno.exit(1)
}
let bundles: Bundle[] = rows.map((b) => {
  let made = b.created as Comp
  return {
    entity: { eid: b.entity.eid },
    venture: { phase: null },
    ...b.archived ? {} : {
      archived: { at: made.at, by: made.by ?? null, via: made.via ?? null },
    },
    $was: { venture: { phase: token(phaseOf(b)) } },
    ...as,
  }
})
if (flag == '--write') await g.apply(bundles, { trusted: true })
let left = await off()
console.log(`${rows.length} shuttered; ${left.length} left`)
for (let b of await g.read('.venture&.archived&*')) {
  console.log(b.entity.eid, (b.archived as Comp).at, phaseOf(b))
}
await close(left.length && flag == '--write' ? 1 : 0)
