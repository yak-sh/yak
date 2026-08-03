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
import { bodyCols, propAt } from './props.ts'
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

// Which subscriptions carry BODIES. Doc bodies are 44% of what a whole-graph
// subscription ships (10.3 MB of 23.4, measured on a copy of the live graph)
// and no board, canvas or shape view reads one — a body is read when a card
// is open. So every subscription defers the declared body columns except the
// two that exist to show one entity whole: `card:<eid>` and `route:<id>`.
export let bodied = (sub: string) => /^(card|route):/.test(sub)

let without = (row: Record<string, unknown>, cut: string[]) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !cut.includes(k)))

// A batch with its body columns left behind — the projection, applied to the
// same Changes a full payload would have shipped, so the two can only differ
// in bytes. Changes are SPREAD, never rebuilt: a precondition rides beside
// `comp` and must survive the trip.
//
// Omitting the column is what makes the deferral legible: the stored column
// defaults to '', so an ABSENT body means unloaded, never empty, and
// live.ts `want()` is the fetch that heals it.
export let bodyless = (changes: Change[]): Change[] =>
  changes.flatMap((c) => {
    let cut = c.comp ? bodyCols(c.name) : []
    if (!cut.some((p) => p in c.comp!)) return [c]
    let comp = without(c.comp!, cut)
    // A patch that was ONLY a body says nothing once the body is gone, and a
    // frame with nothing in it is never sent — so editing a body costs a
    // bodyless subscription no traffic at all. An initial set can't empty
    // this way: a read row always carries its eid.
    return Object.keys(comp).length ? [{ ...c, comp }] : []
  })

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
