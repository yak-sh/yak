// Read-path baselines: the pure half that runs on every ws message.
import { contextDigest, notices, type Reader, rows } from './client.ts'
import { matchQuery, parseQuery } from './query.ts'
import { type Change, type Snapshot } from './types.ts'

// Synthetic 2k-task snapshot, one session holding a handful of claims. This is
// the open-board arm of the digest — the session has no actor, so the
// narrative-memory helpers stay quiet and the cost is the whole-graph filter
// passes plus the per-shown-task block.
let S = crypto.randomUUID()
let changes: Change[] = [
  { eid: S, name: 'entity', comp: { eid: S, num: 1 } },
  { eid: S, name: 'session', comp: { id: 'sess-bench' } },
]
for (let i = 0; i < 2000; i++) {
  let eid = crypto.randomUUID()
  changes.push(
    { eid, name: 'entity', comp: { eid, num: i + 2 } },
    { eid, name: 'doc', comp: { title: `Task ${i}`, body: 'b'.repeat(200) } },
    {
      eid,
      name: 'task',
      comp: { priority: i % 3 },
    },
  )
  if (i % 4 == 0) changes.push({ eid, name: 'completed', comp: {} })
  if (i < 5) changes.push({ eid, name: 'claim', comp: { session: S } })
}
let snap: Snapshot = { changes, deps: [] }
let all = rows(snap)
let ps = parseQuery('.status=open&.priority<=1')

Deno.bench('rows: 2k-task snapshot', () => {
  rows(snap)
})

Deno.bench('query: filter 2k rows (a board render)', () => {
  all.filter((r) => matchQuery(r.comps, ps))
})

Deno.bench('contextDigest: 2k-task graph', () => {
  contextDigest(snap, 'sess-bench')
})

// The SAME 2k board, but the session carries an actor with wrapped sibling
// sessions and comments — so the narrative helpers (unheard, previously,
// resume, onMine) all RUN. Without this the digest bench measured only the
// open-board arm and hid unheard's per-session nested comment scan; this corpus
// makes a reintroduced whole-graph scan there a visible regression.
let recent = new Date(Date.now() - 3600_000).toISOString()
let AS = crypto.randomUUID()
let aTasks: string[] = []
let aCh: Change[] = [
  { eid: AS, name: 'entity', comp: { eid: AS, num: 1 } },
  { eid: AS, name: 'created', comp: { at: recent } },
  {
    eid: AS,
    name: 'session',
    comp: { id: 'sess-actor', actor: 'bench-actor', cwd: '/bench' },
  },
]
for (let i = 0; i < 2000; i++) {
  let eid = crypto.randomUUID()
  aTasks.push(eid)
  // Only a realistic handful are the actor's own work — most of the board
  // belongs to others, as on the live graph.
  let by = i < 20 ? 'bench-actor' : 'other'
  aCh.push(
    { eid, name: 'entity', comp: { eid, num: i + 2 } },
    { eid, name: 'created', comp: { at: recent, by } },
    { eid, name: 'doc', comp: { title: `Task ${i}`, body: 'b'.repeat(200) } },
    {
      eid,
      name: 'task',
      comp: { priority: i % 3 },
    },
  )
  if (i % 4 == 0) aCh.push({ eid, name: 'completed', comp: {} })
  if (i < 5) aCh.push({ eid, name: 'claim', comp: { session: AS } })
}
let aSibs: string[] = []
for (let i = 0; i < 10; i++) {
  let eid = crypto.randomUUID()
  aSibs.push(eid)
  aCh.push(
    { eid, name: 'entity', comp: { eid, num: 3000 + i } },
    { eid, name: 'created', comp: { at: recent } },
    { eid, name: 'updated', comp: { at: recent } },
    { eid, name: 'session', comp: { id: `sib-${i}`, actor: 'bench-actor' } },
    { eid, name: 'doc', comp: { title: `Sibling ${i}`, body: 'brief line' } },
    { eid, name: 'brief', comp: {} },
  )
}
for (let i = 0; i < 50; i++) {
  let eid = crypto.randomUUID()
  let target = i % 2 ? aTasks[i % 5] : aSibs[i % aSibs.length]
  aCh.push(
    { eid, name: 'entity', comp: { eid, num: 4000 + i } },
    { eid, name: 'created', comp: { at: recent, by: 'someone-else' } },
    { eid, name: 'doc', comp: { title: '', body: `comment ${i}` } },
    { eid, name: 'comment', comp: { target } },
  )
}
let aSnap: Snapshot = { changes: aCh, deps: [] }

Deno.bench('contextDigest: 2k graph, actor path', () => {
  contextDigest(aSnap, 'sess-actor')
})

// notices()/channelEvents — the comms bus read side. It runs on every tool call
// and every boot digest over the WHOLE snapshot (noticesFor's whole-graph arm):
// notices() builds byEid once and flattens to changes, then channelEvents scans
// every change for the handful aimed at this session (comment / knock / mail /
// recall). Unbenched until T-18136 — surfaced by the T-18133 digest audit: clean
// on read, never measured. This corpus is the 2k board plus a realistic scatter
// of comments, knocks, and verified mail addressed to one operator session, so a
// reintroduced whole-graph scan on the comms path is a visible regression. The
// reader is built directly (not readerFor) so the addressed set is deterministic
// and nothing is `notified` yet — the max-work first-read where every event
// rings.
let NS = crypto.randomUUID() // the served session
let NA = crypto.randomUUID() // its actor
let NH = crypto.randomUUID() // its home project
let nAt = new Date(Date.now() - 3600_000).toISOString()
let nClaims: string[] = []
let nTasks: string[] = []
let nCh: Change[] = [
  { eid: NH, name: 'entity', comp: { eid: NH, num: 1 } },
  { eid: NH, name: 'project', comp: {} },
  { eid: NH, name: 'doc', comp: { title: 'Home', body: '' } },
  { eid: NA, name: 'entity', comp: { eid: NA, num: 2 } },
  { eid: NS, name: 'entity', comp: { eid: NS, num: 3 } },
  { eid: NS, name: 'created', comp: { at: nAt } },
  {
    eid: NS,
    name: 'session',
    comp: { id: 'sess-bus', actor: NA, cwd: '/bench', operator: 1 },
  },
]
for (let i = 0; i < 2000; i++) {
  let eid = crypto.randomUUID()
  nTasks.push(eid)
  nCh.push(
    { eid, name: 'entity', comp: { eid, num: 100 + i } },
    { eid, name: 'created', comp: { at: nAt, by: 'other' } },
    { eid, name: 'doc', comp: { title: `Task ${i}`, body: 'b'.repeat(120) } },
    {
      eid,
      name: 'task',
      comp: { priority: i % 3, project: NH },
    },
  )
  if (i % 4 == 0) nCh.push({ eid, name: 'completed', comp: {} })
  if (i < 5) {
    nClaims.push(eid)
    nCh.push({ eid, name: 'claim', comp: { session: NS } })
  }
}
// Comments: some to the session, some to claimed tasks (both ring), the rest to
// other tasks (filtered out) — the realistic ratio the bus sifts every call.
for (let i = 0; i < 40; i++) {
  let eid = crypto.randomUUID()
  let target = i < 8 ? NS : i < 16 ? nClaims[i % nClaims.length] : nTasks[i]
  nCh.push(
    { eid, name: 'entity', comp: { eid, num: 5000 + i } },
    { eid, name: 'created', comp: { at: nAt, by: 'someone-else' } },
    { eid, name: 'doc', comp: { title: '', body: `comment body ${i}` } },
    { eid, name: 'comment', comp: { target } },
  )
}
// Knocks to the session or its actor, fresh (no delivered/error facet) so they
// ring rather than read as settled receipts.
for (let i = 0; i < 10; i++) {
  let eid = crypto.randomUUID()
  nCh.push(
    { eid, name: 'entity', comp: { eid, num: 6000 + i } },
    { eid, name: 'created', comp: { at: nAt } },
    { eid, name: 'knock', comp: { target: nTasks[i] } },
    { eid, name: 'deliver', comp: { to: i % 2 ? NS : NA } },
    { eid, name: 'doc', comp: { title: '', body: `knock note ${i}` } },
  )
}
// Mail: verified arrivals to the home project (operator → inject), plus
// unverified and already-opened letters the bus must filter.
for (let i = 0; i < 10; i++) {
  let eid = crypto.randomUUID()
  nCh.push(
    { eid, name: 'entity', comp: { eid, num: 7000 + i } },
    { eid, name: 'created', comp: { at: nAt } },
    { eid, name: 'doc', comp: { title: `Subject ${i}`, body: `letter ${i}` } },
    {
      eid,
      name: 'mail',
      comp: {
        target: NH,
        from: `p${i}@ext.example`,
        verified: i % 3 ? 1 : 0,
        received_at: nAt,
        message_id: `m${i}`,
      },
    },
  )
  if (i % 4 == 0) nCh.push({ eid, name: 'opened', comp: {} })
}
let nSnap: Snapshot = { changes: nCh, deps: [] }
let nAll = rows(nSnap)
let nWho: Reader = {
  session: NS,
  actor: NA,
  scope: NH,
  operator: true,
  claims: new Set(nClaims),
}

Deno.bench('notices: comms bus over 2k graph', () => {
  notices(nAll, nWho)
})

// --- the client's own cache build (live.ts) ---------------------------------
// What a browser tab and the TUI both pay between the socket's seed frame and
// first paint: applyLocal folds the frame into the cache, then resetSignals
// rebuilds the id index, the derived index and every partition in ONE pass
// (D-18055 — the per-row maintenance during a seed was the dominant boot CPU).
// A regression that re-introduces per-row indexing under a seed, or turns the
// one index pass into a per-row one, shows up here as a multiple.
//
// The corpus is working-set sized (what workingSet() actually sends a cold
// boot), not a whole graph.
let { applyLocal, cache, resetSignals } = await import('./live.ts')

let seed: Change[] = []
for (let i = 0; i < 200; i++) {
  let eid = crypto.randomUUID()
  seed.push(
    { eid, name: 'entity', comp: { eid, num: 10_000 + i } },
    { eid, name: 'doc', comp: { title: `Seeded ${i}`, body: 'b'.repeat(120) } },
    { eid, name: 'task', comp: { priority: i % 3 } },
  )
}

Deno.bench('applyLocal: fold a working-set seed into the cache', () => {
  cache.value = {}
  applyLocal(seed)
})

// The index rebuild a seed ends with — one pass over the whole cache.
cache.value = {}
applyLocal(seed)
Deno.bench('resetSignals: rebuild every index from the cache', () => {
  resetSignals()
})
