// Query subscriptions, the pure seam (T-3683). A subscription is
// {preds, members}: the parsed query and the eids currently in its set. Per
// committed batch the server re-tests each touched eid and streams the
// transition — this file holds the socket-free heart (the §2 transition table
// and the comps→Changes spread) so it tests without a server. server.ts wires
// these to the live stream and the eager db reads; subs_test.ts drives them
// with plain values.
//
// The membership Set IS the memory that makes "you no longer match" (a drop)
// as cheap as an add: no client can say that today because no client knows
// another's query — centralizing the matcher on the server is what makes it
// expressible (design §2).
import { propAt } from './props.ts'
import { type Pred } from './query.ts'
import { span } from './time.ts'
import { type Change } from './types.ts'

// The five outcomes of testing one touched eid against one subscription
// (design §2): a fresh match ADDS, a standing match UPDATES, a lost match
// leaves the set (REMOVE → a drop), a death forwards an entity-null, and an
// eid that was never in and doesn't match is IGNOREd.
export type Step = 'add' | 'update' | 'remove' | 'dead' | 'ignore'

// One touched eid against one subscription's members. `alive` = the eid still
// has a spine (an entity-null in the batch clears it); `matches` = matchQuery
// over its current comps. Mutates members — the transition IS the bookkeeping,
// so the caller reads only the returned verb.
export let step = (
  members: Set<string>,
  eid: string,
  alive: boolean,
  matches: boolean,
): Step => {
  let was = members.has(eid)
  if (!alive) return was ? (members.delete(eid), 'dead') : 'ignore'
  if (matches) return was ? 'update' : (members.add(eid), 'add')
  return was ? (members.delete(eid), 'remove') : 'ignore'
}

// An entity's components as a Change batch — the payload of an ADD and of the
// initial subscribe set. comps is eid→comp (entity rides too, as {eid,num});
// edges don't ride here (stage 1 subs are own-comp, deps join in stage 2).
export let spread = (
  eid: string,
  comps: Record<string, unknown>,
): Change[] =>
  Object.entries(comps).map(([name, comp]) => ({
    eid,
    name,
    comp: comp as Change['comp'],
  }))

// Agreement is hard while membership depends only on the row being changed.
// Paths need the far-side change index; moving time needs a clock sweep.
export type Gap = 'path' | 'moving-time'

let atoms = (value: string) =>
  value.split(',').flatMap((v) => {
    let m = v.match(/^(.*?)\.\.(?:\.?)(.*)$/s)
    return m ? [m[1], m[2]] : [v]
  }).filter(Boolean)

let fixed = (value: string) => /^\d{4}-\d{2}-\d{2}(?:[t ].*)?$/i.test(value)

let moving = (p: Pred) => {
  let target = p.at ?? p
  if (propAt(target.comp, target.prop)?.type != 'time') return false
  return atoms(p.value).some((v) => !fixed(v) && !!span(v))
}

export let gaps = (preds: Pred[]): Gap[] => [
  ...preds.some((p) => !!p.at) ? ['path' as Gap] : [],
  ...preds.some(moving) ? ['moving-time' as Gap] : [],
]

export type Diff = { scanOnly: string[]; subOnly: string[] }
export let diff = (scan: Iterable<string>, sub: Iterable<string>): Diff => {
  let a = new Set(scan), b = new Set(sub)
  return {
    scanOnly: [...a].filter((eid) => !b.has(eid)).sort(),
    subOnly: [...b].filter((eid) => !a.has(eid)).sort(),
  }
}
