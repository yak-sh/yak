// Auto-recall (T-17306, v2 T-17470): the delivery-agnostic core — WHAT should
// float up for a message, never WHO delivers it. A message comes in and the
// nearest IN-SCOPE thoughts surface — a memory, a related open ticket, a prior
// doc — the way a mind's own memories arrive as it thinks rather than by
// reaching for a search tool. Embed the text, rank every stored vector by
// cosine (embed.ts similar), keep the nearest per KIND above that kind's floor
// and inside the session's scope, drop what this session already saw.
//
// The split that keeps it testable: recallFrom takes a query VECTOR and the
// session's SCOPE — pure, driven by precomputed vectors in the test like
// embed_test — while recall() adds the one slow embed() over raw text and the
// effect resolves the scope. WHO delivers the floaters (the tasks channel's
// kind=recall item, replayed into a native session's transcript) lives in
// channel.ts and imports only this.
import { type DatabaseSync } from './sqlite.ts'
import { embed, similar } from './embed.ts'
import { apply, human, rowsOf } from './db.ts'
import { db } from './live_db.ts'
import { commitEffects } from './effects.ts'
import { belongs, type Scoped, scopeFor } from './client.ts'
import { type Change } from './types.ts'

export type Floater = { id: string; eid: string; title: string; score: number }

// The eid→id storage seam (D-18866): component tables key by the owner int id
// and store refs (and edge endpoints) as int ids; this module speaks EIDs.
// OWNED matches a row by owner eid, idOf resolves a ref filter's eid operand,
// refEid projects a stored ref id back to its eid on read.
let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`
let refEid = (col: string) => `(select eid from entity where id = ${col})`

// Which kinds float, and for each: how many a message may surface (budget) and
// the cosine floor below which a hit is noise, not a related thought. Budgets
// are PER KIND so a flood of near tasks can never consume a memory's slots —
// memories are the highest-value recall and always get their two — which is the
// tension D-17459 names: dropping the memory-only filter naively swamps the few
// memories under the far more numerous tasks.
//
// The floors, measured against the live graph (T-17470) by the same method the
// memory floor was: sample real message->entity pairs, see where the genuinely
// related land vs where noise tops out, pick the gap. Messages are work prose
// ABOUT tickets, so they run HOT against everything — the nearest task is >=0.63
// for ~90% of messages — and the noise ceiling rides up with it:
//   - memory 0.55: the message->memory floor (a question and the memory that
//     answers it land 0.57-0.67, unrelated tops ~0.40). Memories are sparse, so
//     a low floor floats the real ones without a flood.
//   - task 0.70: below ~0.67 token-noise creeps in (shared boilerplate — /clear
//     and /loop echoes, GREEN/YELLOW pacing chatter — pulls unrelated tickets
//     up); at >=0.70 the match is the ticket the message is actually about
//     (median nearest-task is 0.711).
//   - doc 0.72: docs/sessions distribute like tasks but a floated doc is lower
//     value (budget 1), so a higher-precision bar keeps only strong matches.
export let KINDS: Record<string, { budget: number; floor: number }> = {
  memory: { budget: 2, floor: 0.55 },
  task: { budget: 2, floor: 0.70 },
  doc: { budget: 1, floor: 0.72 },
}

// A candidate's kind, most specific first — the same precedence belongs() reads
// its scope by, so scope and budget classify a task-doc or a memory-doc alike.
// Everything doc-bearing but neither a task nor a memory (a design, a prior
// session, a persona) shares the catch-all `doc` budget.
let kindOf = (r: Scoped): keyof typeof KINDS =>
  r.comps.task ? 'task' : r.comps.memory ? 'memory' : 'doc'

// The ranked net's floor is the LOWEST kind floor, so a sparse memory at 0.55
// is not discarded before we reach it. But messages are so hot that ~1700
// entities clear 0.55 (median) and the nearest memory sits at rank ~14, p90 67,
// max ~235 among them — a small net would let dense tasks/docs crowd memories
// out. So the net is wide; similar() scans every vector regardless (that fixed
// cost is embed()'s, not ours), so a wide net costs only the extra liveness
// lookups on its head plus one batched rowsOf() over it.
let SCAN = 500

// A candidate this session must not have a scope that is a DIFFERENT project.
// A no-project session can't place a scoped candidate, so it floats globals
// only: a non-eid stands in for its scope, so every real project reads as "not
// mine" and belongs() keeps only the ownerless (global memories, plain docs).
let NO_PROJECT = 'no-project'

// The pure core: nearest in-scope thoughts to a query vector, per-kind floored
// and budgeted, deduped, scoped. `scope` is the session's project (undefined =
// float globals only). `seen` is the eids this session already floated — a
// thought shown twice is noise — and the caller owns that ledger, so this stays
// a pure function of (graph, query, scope, seen). Classification and scoping
// read one batched rowsOf() over the ranked head, never a per-candidate probe.
export let recallFrom = (
  db: DatabaseSync,
  q: Float32Array,
  scope?: string,
  seen: Set<string> = new Set(),
  kinds = KINDS,
): Floater[] => {
  let net = Math.min(...Object.values(kinds).map((k) => k.floor))
  let hits = similar(db, q, SCAN, net)
  let rows = new Map(
    (rowsOf(db, hits.map((h) => h.eid)) as Scoped[]).map((r) => [r.eid, r]),
  )
  let took: Record<string, number> = {}
  let out: Floater[] = []
  for (let h of hits) {
    if (seen.has(h.eid)) continue
    let r = rows.get(h.eid)
    if (!r) continue
    let k = kindOf(r)
    let cfg = kinds[k]
    if (h.score < cfg.floor) continue
    if ((took[k] ?? 0) >= cfg.budget) continue
    if (!belongs(r, scope ?? NO_PROJECT)) continue
    let title = String(r.comps.doc?.title ?? '').trim()
    if (!title) continue
    took[k] = (took[k] ?? 0) + 1
    out.push({ id: human(db, h.eid), eid: h.eid, title, score: h.score })
  }
  return out
}

// The whole door: text in, floaters out. A box with no embedder recalls nothing
// and says so with silence, never an error — exactly how the dupe hint degrades.
// The embedder is the one slow step, so it stays outside the pure core above.
export let recall = async (
  db: DatabaseSync,
  text: string,
  scope?: string,
  seen: Set<string> = new Set(),
  kinds = KINDS,
): Promise<Floater[]> => {
  let vec = await embed(text)
  return vec ? recallFrom(db, vec, scope, seen, kinds) : []
}

// The recall entry as a batch, pure: the entry in the session's partition, the
// floater text one line per thought, the `recalled` link back to the message
// that surfaced them, and a `recalled` edge per floater — the edges being the
// dedup ledger the next message screens against. The effect applies this; a
// test asserts on it without an embedder.
export let writeRecall = (
  session: string,
  source: string,
  floaters: Floater[],
  rid: string = crypto.randomUUID(),
): Change[] => [
  { eid: rid, name: 'entry', comp: { session } },
  {
    eid: rid,
    name: 'content',
    comp: { body: floaters.map((f) => `${f.id} · ${f.title}`).join('\n') },
  },
  { eid: rid, name: 'recalled', comp: { source } },
  ...floaters.map((f): Change => ({
    eid: rid,
    name: 'dependency',
    comp: { type: 'recalled', child: f.eid },
  })),
]

// The session's project: the same resolver the boot digest scopes by — an
// explicit cwd repo, else the worn persona's home, else the actor-as-project
// (client.ts scopeFor). Fed the minimal rows it reads: the session, every
// project-with-repo (for the cwd match), and the session's persona and actor.
let scopeOf = (sessionEid: string): string | undefined => {
  let sess = (rowsOf(db, [sessionEid]) as Scoped[])[0]
  if (!sess) return undefined
  let s = sess.comps.session ?? {}
  let repos = (db.prepare(
    'select o.eid as eid from repo r join entity o on o.id = r.entity',
  ).all() as { eid: string }[])
    .map((r) => r.eid)
  let kin = [String(s.persona ?? ''), String(s.actor ?? '')].filter(Boolean)
  let all = rowsOf(db, [...new Set([sessionEid, ...repos, ...kin])]) as Scoped[]
  return scopeFor(
    all,
    all.find((r) => r.eid == sessionEid),
    String(s.cwd ?? ''),
  )
}

// The effect (T-17306): a new message entry recalls in-scope thoughts into the
// session's OWN log — a durable `recalled` entry the channel then pushes
// (kind=recall) and a native session replays as part of its transcript. WHAT
// floats is recall() above; WHO sees it is the channel; this only writes the
// entry, scoped to the session's project.
//
// Fires on `message` created only — new entries, never history — so deploying
// it touches messages from here forward, not the 110k already ingested. NO
// sweep: recall is best-effort ambient (a thought that missed its beat is
// simply gone, and the next message recalls anyway). A recall entry carries no
// `message` facet, so it never reaches this handler — recall cannot recall
// itself. The idempotency check keeps a double-fire from doubling a floater;
// the `recalled` edges let this session's earlier floaters screen the next.
export let recallEntry =
  (cast: (c: Change[]) => void, recallFn = recall) => async (eid: string) => {
    let src = db.prepare(
      `select ${refEid('session')} as session from entry where ${OWNED}`,
    ).get(eid) as
      | { session?: string }
      | undefined
    let session = src?.session
    if (!session) return
    if (db.prepare(`select 1 from recalled where source = ${idOf}`).get(eid)) {
      return
    }
    let row = db.prepare(`select body from content where ${OWNED}`).get(eid) as
      | { body?: string }
      | undefined
    let text = String(row?.body ?? '').trim()
    if (!text) return
    let seen = new Set(
      (db.prepare(
        `select distinct ${refEid('d.child')} as child from dependency d
           join entry e on e.entity = d.parent
          where e.session = ${idOf} and d.type = 'recalled'`,
      ).all(session) as { child: string }[]).map((r) => r.child),
    )
    let floaters = await recallFn(db, text, scopeOf(session), seen)
    if (floaters.length) {
      commitEffects(
        (trace) => apply(db, writeRecall(session, eid, floaters), trace),
        cast,
      )
    }
  }
