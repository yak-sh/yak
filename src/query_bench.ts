// The SERVER query pipeline — the half a browser, a CLI and an agent all wait
// on, and the half that used to be invisible to the ratchet. db_bench.ts clamps
// the single keyed reads (eager, resolveId, journalOf); this file clamps what
// runs OVER a set: the boot seed, a board's membership window, a tally, the
// batched hydration every keyed door reads through, FTS, and the catch-up a
// reconnect replays.
//
// Each bench is ONE call over a resident 2k-task graph, sized so it stays under
// the control bench (~3ms, control_bench.ts) — the gate's ratio only means
// something while the control is the slowest op in the suite. The point is not
// the absolute number: it is that a scan reintroduced where an index or a
// one-pass read belongs shows up as a multiple. Three of these are the exact
// shapes that were multiples on the live graph (T-33706):
//   - workingSet   — an eager() per eid, 971ms where one pass is 105ms
//   - evalAgg      — a derived tally hydrating its whole selection, 805ms vs 7ms
//   - the FTS arm  — an eager() per ranked hit, 2503ms vs 1128ms for 50 hits
Deno.env.set('DB_PATH', ':memory:')
let { apply, delta, matching, rowsOf, search } = await import('./db.ts')
let { db } = await import('./live_db.ts')
let {
  askOf,
  askRows,
  evalAgg,
  evalGraph,
  evalSub,
  rowsFor,
  workingSet,
} = await import('./graph_query.ts')
let { where } = await import('./sql.ts')
let { parseQuery } = await import('./query.ts')
let { toSql } = await import('./relation.ts')

let uid = () => crypto.randomUUID()

// One project, 2000 tasks under it, a quarter of them done and a handful
// claimed — so `.status` has every value the derived CASE can answer, and a
// tally that fell back to hydrating the selection has 2000 rows to hydrate.
let PROJ = uid()
let SESS = uid()
apply(db, [
  { eid: PROJ, name: 'doc', comp: { title: 'Bench project', body: '' } },
  { eid: PROJ, name: 'project', comp: {} },
  { eid: SESS, name: 'session', comp: { id: 'bench-sess' } },
])
let N = 600
let eids = Array.from({ length: N }, uid)
eids.forEach((eid, i) => {
  apply(db, [
    {
      eid,
      name: 'doc',
      comp: {
        title: `Bench task ${i}`,
        // Only a slice carries the searched word, so the FTS bench measures a
        // ranked read of a realistic hit set, not the whole corpus.
        body: `paragraph ${i} about ${
          i % 20 == 0 ? 'flugelbinder' : 'ratchets'
        } and windows\n`.repeat(3),
      },
    },
    { eid, name: 'task', comp: { priority: i % 3, project: PROJ } },
    ...(i % 4 == 0 ? [{ eid, name: 'completed', comp: {} }] : []),
    ...(i % 97 == 0 ? [{ eid, name: 'claim', comp: { session: SESS } }] : []),
  ])
})

// The chrome a working-set boot seeds: WS_SETS names canvases, pins, cards,
// projects, favorites, cursors, cameras, folds, shelves and clients. A canvas
// with pinned cards is the shape that actually rides the wire.
let CANVAS = uid()
apply(db, [
  { eid: CANVAS, name: 'canvas', comp: {} },
  { eid: CANVAS, name: 'doc', comp: { title: 'Bench canvas', body: '' } },
])
for (let i = 0; i < 12; i++) {
  let card = uid()
  apply(db, [
    { eid: card, name: 'card', comp: { target: eids[i], view: 'Show' } },
    {
      eid: card,
      name: 'pin',
      comp: { canvas: CANVAS, x: i * 10, y: i * 6, w: 320, h: 200, z: i },
    },
  ])
  let fav = uid()
  apply(db, [
    { eid: fav, name: 'doc', comp: { title: `Fav ${i}`, body: '' } },
    { eid: fav, name: 'favorite', comp: {} },
  ])
}

// The boot seed itself: every WS_SETS query, then the whole set hydrated. The
// regression this guards is a per-eid read replacing the one-pass one.
Deno.bench('workingSet: the boot seed', () => {
  workingSet(db)
})

// A board is a saved query, and a fullscreen board opens a WINDOW over its
// membership (live.ts BOARD_WINDOW). This is the exact sub a board load sends.
Deno.bench('evalSub: a board window over the corpus', () => {
  evalSub(db, `.project=${PROJ}&.limit=400`, false)
})

// The status tally beside it (T-22509): 4 numbers, and it must cost 4 numbers.
// task.status is DERIVED, so this is the bench that catches aggregateSql
// declining it again and hydrating the whole selection to count in JS.
Deno.bench('evalAgg: a derived status tally over a project', () => {
  evalAgg(db, `.project=${PROJ}&.tally=task.status`)
})

// The hydration workhorse under every membership query: one statement per
// component table for a whole hit set, never one per row.
let boardSql = toSql(where(parseQuery(`.project=${PROJ}`))!)
Deno.bench('matching: hydrate the whole selection', () => {
  matching(db, boardSql)
})

// The keyed door: a set of ids read in one pass. rowsOf is what /query's `id=`,
// the backlinks layer and every change-builder read through.
let some = eids.slice(0, 50)
Deno.bench('rowsOf: 50 ids in one pass', () => {
  rowsOf(db, some)
})

// Same set through the public reader, which also locates each id and shapes
// the rows — the door a change-builder actually calls.
Deno.bench('rowsFor: 50 ids located and shaped', () => {
  rowsFor(db, some)
})

// The whole /query door for an addressed read, layers and all.
let ask = askOf([`id=${some.slice(0, 10).join(',')}`])
Deno.bench('askRows: an addressed /query read', async () => {
  await askRows(db, ask)
})

// The indexed lane of an ordinary filter — the one a board, `task list` and
// every MCP list tool ride.
Deno.bench('evalGraph: an indexed filter over the corpus', () => {
  evalGraph(db, `.status=open&.priority<=1`)
})

// Search is a `/query` text predicate over FTS5, and its ranked hits are
// hydrated in one pass beside their `rank` component.
Deno.bench('evalGraph: an FTS text query, hits hydrated', () => {
  evalGraph(db, 'flugelbinder&.limit=30')
})
Deno.bench('search: the ranked FTS read alone', () => {
  search(db, 'flugelbinder', 30)
})

// The reconnect: every change since a cursor, replayed as the frames the live
// cast carries. A tab that slept through a burst reads exactly this.
let mid = 0
{
  let d = delta(db, 0)
  mid = Math.max(0, d.cursor - 200)
}
Deno.bench('delta: catch-up from a 200-row-old cursor', () => {
  delta(db, mid)
})
