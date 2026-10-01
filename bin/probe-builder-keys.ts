// Scratch probe for T-61728; not committed.
import type { Comp } from '@yaks/graph'
import { EDGE } from '@yaks/edge'
import {
  buildFor,
  clock,
  outputFor,
  reconcile,
} from '../packages/builders/build.ts'
import { close, opened } from '../packages/cli/local.ts'

let host = await opened(Deno.args[0], ['graph'], false)
let g = host.graph
let str = (v: unknown) => v == null ? '' : String(v)

let builds = await g.read('.build&?build')
let wrong = 0
for (let b of builds) {
  let c = b.build as Comp
  let found = await buildFor(
    g,
    str(c.builder),
    JSON.parse(str(c.match)),
    str(c.variant || 'main'),
  )
  if (found != b.entity.eid) wrong++
}
let outputs = await g.read(`.built.slot&!${EDGE}&?built`)
let astray = 0
for (let o of outputs) {
  let c = o.built as Comp
  if (await outputFor(g, str(c.build), str(c.slot)) != o.entity.eid) astray++
}
console.log(
  `builds ${builds.length}, wrong ${wrong}; outputs ${outputs.length}, ` +
    `astray ${astray}`,
)

let calls = 0, fresh = 0, plans = 0, dup = 0
for (let def of await g.read('.builder&*')) {
  let r = await g.storage.tx((tx) =>
    reconcile(
      tx,
      { ...def, archived: undefined },
      { vocab: host.vocab },
      clock(),
      false,
      true,
    )
  )
  plans += r.plans.length
  for (let p of r.plans.filter((p) => p.build.startsWith('$'))) {
    fresh++
    if (await buildFor(g, p.builder, p.binding.entities, p.variant)) dup++
  }
  calls += r.writes.filter((w) => w.call).length
}
console.log(
  `plans ${plans}, new builds ${fresh}, already built ${dup}, calls ${calls}`,
)
await close(0)
