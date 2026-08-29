// Persona watch = spawn rule (D-21239): the watch/mute table is the routing
// table, and the watcher's type picks the delivery mode. A HUMAN's watch is a
// delivery subscription — inboxItem (client.ts) reads it at query time,
// exactly as before. A PERSONA's watch is a spawn rule: an event about the
// watched target (a comment, a notice, a knock, an arrived letter)
// instantiates the persona as a run instead of notifying anyone.
//
// The match never spawns inline — it marks the target wanted: a `wants` edge,
// persona wants target, minted here and drained by the dispatch sweep
// (dispatch.ts) under the DISPATCH_SLOTS cap. The edge is the queue row: a
// triple is idempotent, dies with either endpoint, and `graph_query` can
// list the pending marks. Debounce is per (persona, target): while a live
// run of the persona attends the target the event already reaches its
// transcript (the hot-session delivery, D-21263), so no mark is minted —
// and a mark that goes stale the same way is cleared by the sweep unspent.
// ruled() is the effect shell (SERVER-ONLY: imports db); the decision table
// above it is pure over Rows and fast-tier tested.
import { apply, depsOf } from './db.ts'
import { db } from './live_db.ts'
import { commitEffects } from './effects.ts'
import { type Change, type Dep, sessionActive } from './types.ts'
import { type Row } from './client.ts'
import { evalGraph, rowsFor } from './graph_query.ts'

type Cast = (changes: Change[]) => void

// An entity that IS a persona — including a project wearing base-persona
// comps (D-21308). The routing fork: personas spawn, everyone else delivers.
export let isPersona = (r?: Row) => !!r?.comps.persona

// A session holding its slot: live until a terminal status — including the
// moment before the launch effect stamps 'starting'.
export let liveRun = (s: Record<string, unknown>) =>
  !s.status || sessionActive.includes(String(s.status))

// A live run of this persona already attending the target: spawned onto it
// (requested_task is set at birth, before the auto-claim lands) or holding
// its lease. The event flows into that run, never a second spawn.
export let hotRun = (all: Row[], persona: string, target: Row) =>
  all.find((r) => {
    let s = r.comps.session
    if (!s || String(s.persona) != persona || !liveRun(s)) return false
    return String(s.requested_task) == target.eid ||
      String(target.comps.claim?.session) == r.eid
  })

// The decision table for one event: each watch subscription on its target
// whose actor is a persona yields a pending mark — unless a hot run already
// attends the target, or the mark is already pending. Human watchers yield
// nothing: their watch stays a delivery subscription. Only a TASK target is
// spawnable-onto (the same line knock rung 2 draws); events about anything
// else stay delivery-only for now.
export let spawnMarks = (
  target: Row | undefined,
  subs: Row[],
  actors: Row[],
  sessions: Row[],
  deps: Dep[],
): Change[] => {
  if (!target?.comps.task) return []
  let by = new Map(actors.map((r) => [r.eid, r]))
  let out: Change[] = []
  for (let s of subs) {
    let sub = s.comps.subscription
    if (sub?.mode != 'watch' || String(sub.target) != target.eid) continue
    let actor = by.get(String(sub.actor))
    if (!isPersona(actor)) continue
    if (hotRun(sessions, actor!.eid, target)) continue
    let pending = deps.some((d) =>
      d.type == 'wants' && d.parent == actor!.eid && d.child == target.eid
    )
    if (pending) continue
    out.push({
      eid: actor!.eid,
      name: 'dependency',
      comp: { type: 'wants', child: target.eid },
    })
  }
  return out
}

// The effect shell: fires on a created comment/notice/knock/arrived-mail
// (server.ts registers it per component) and reads only what the decision
// needs — the watch rows on the target, their actors, the personas' live
// sessions, and the target's standing marks. No watchers is the common case
// and costs one scoped query.
export let ruled =
  (cast: Cast) => (_eid: string, comp: Record<string, unknown>) => {
    let about = String(comp.target ?? '')
    if (!about) return
    let subs = evalGraph(
      db,
      `.subscription.target=${about}&.subscription.mode=watch`,
    ).hits
    if (!subs.length) return
    let actors = rowsFor(
      db,
      subs.map((s) => String(s.comps.subscription?.actor ?? '')),
    )
    let personas = actors.filter(isPersona)
    if (!personas.length) return
    let [target] = rowsFor(db, [about])
    let sessions = evalGraph(
      db,
      `.session.persona=${personas.map((p) => p.eid).join(',')}`,
    ).hits
    let marks = spawnMarks(
      target,
      subs,
      actors,
      sessions,
      depsOf(db, [about]),
    )
    if (!marks.length) return
    commitEffects((t) => apply(db, marks, t), cast)
  }
