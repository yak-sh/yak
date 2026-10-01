#!/usr/bin/env -S deno run -A
// One-time (T-61616): the pilot's beliefs, topics and cites edges that batch
// #7638323 deleted come back through undo of that delete (@yaks/journal
// `undone`), and every belief and topic then wears the kernel's
// `archived{at, by, via}` mark. The batch also recorded the tool call that
// made it (`execution`, `result`, `content`), so the undo is cut to the
// entities the batch deleted and that record stands.
//
//   deno run -A bin/restore-pilot.ts <config> [--write]

import { type Bundle, type Comp, TOMBSTONE } from '@yaks/graph'
import { undone } from '@yaks/journal'
import { logFor } from '@yaks/journal/rules'
import { close, opened, signer } from '../packages/cli/local.ts'

let SEQ = 7638323

let [path, flag] = Deno.args
let host = await opened(path, ['graph'], false)
let g = host.graph
let as = await signer(host, Deno.env.get('CLAUDE_CODE_SESSION_ID'))

let j = logFor(host)
let batch = j.at(SEQ)
if (!batch) throw new Error(`no batch #${SEQ}`)
let dead = new Set(
  batch.deltas.filter((d) => d.comp == TOMBSTONE && d.after != null)
    .map((d) => d.target),
)
let back = undone(
  { ...batch, deltas: batch.deltas.filter((d) => dead.has(d.target)) },
  { guard: true },
)

let KINDS = ['belief', 'topic', 'cites']
let tally = (bs: Bundle[]) =>
  Object.fromEntries(
    KINDS.map((k) => [k, bs.filter((b) => b[k] != null).length]),
  )
// An entity's stored values: what the journal says it held just before the
// batch, against what it holds now but for the stamps, the new mark and
// what is computed at read.
let STAMPS = ['created', 'updated', 'archived']
let stored = (comp: string, prop: string, v: unknown) =>
  v != null && !g.vocab.prop(comp, prop)?.computed
let held = (b: Bundle) =>
  JSON.stringify(
    Object.entries(b).filter(([k]) => k != 'entity' && !STAMPS.includes(k))
      .map(([k, c]) => [
        k,
        Object.entries(c as Comp).filter(([p, v]) => stored(k, p, v)).sort(),
      ]).sort(),
  )
let now = async () => {
  let got = await g.get([...dead])
  return {
    alive: got.filter((b) => b[TOMBSTONE] == null).length,
    ...tally(got),
    archived: got.filter((b) => b.archived != null).length,
    same:
      got.filter((b) =>
        held(b) == held({ entity: b.entity, ...j.before(b.entity.eid, SEQ) })
      ).length,
  }
}

console.log(`batch #${SEQ}: ${dead.size} deleted`, tally(back))
console.log('before', await now())
if (flag == '--write') {
  await g.apply([{ ...back[0], ...as }, ...back.slice(1)], { trusted: true })
  let shelf = back.filter((b) => b.belief != null || b.topic != null)
    .map((b): Bundle => ({
      entity: { eid: b.entity.eid },
      archived: {},
      ...as,
    }))
  await g.apply(shelf)
}
console.log('after', await now())
let builders = await g.read('.builder&*')
console.log(
  `builders ${builders.length}, archived`,
  builders.filter((b) => b.archived != null).length,
)
await close(0)
