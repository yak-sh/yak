// Memory auto-recall (T-17306): the delivery-agnostic core — WHAT should float
// up, never WHO delivers it. A message comes in and the nearest MEMORY entities
// surface, the way a mind's own memories arrive as it thinks rather than by
// reaching for a search tool. Embed the text, rank every stored vector by cosine
// (embed.ts similar), keep only memory-kind hits above the twin floor, drop what
// this session already saw, return the top few.
//
// The split that keeps it testable: recallFrom takes a query VECTOR — pure, and
// driven by precomputed vectors in the test like embed_test — while recall()
// adds the one slow embed() over raw text. WHO delivers the floaters (a channel
// item aimed at the session, a hook) lives elsewhere and imports only this.
import { type DatabaseSync } from 'node:sqlite'
import { embed, similar } from './embed.ts'
import { apply, db, human } from './db.ts'
import { type Change } from './types.ts'

export type Floater = { id: string; eid: string; title: string; score: number }

// Recall's floor is NOT the dupe hint's floor. embed.ts FLOOR (0.78) is tuned
// for near-IDENTICAL text — the wrong bar here, where a message and the memory
// it should surface are RELATED, not duplicate. Measured against the live graph,
// a question and the memory that answers it land at 0.57–0.67 (e.g. "should I
// escalate…" → M-17299 "escalation is a bug report" at 0.60), while an unrelated
// message tops out at ~0.40. 0.55 sits in that gap: confident related thoughts
// float, noise stays down. Tune here as the corpus grows (T-17306 v2).
export let RECALL = 0.55

// Memories are sparse among all doc-bearing entities, so rank a wide net before
// the memory filter thins it — else the few real memories never surface under a
// crowd of tasks. similar() does point lookups, so a wide net stays cheap.
let NET = 60

// The pure core: nearest memories to a query vector, floored, deduped, capped.
// `seen` is the eids this session already floated — a memory shown twice is
// noise, not a thought — and the caller owns that ledger (a state file, the
// channel's own record), so this stays a pure function of (graph, query, seen).
export let recallFrom = (
  db: DatabaseSync,
  q: Float32Array,
  limit = 3,
  floor = RECALL,
  seen: Set<string> = new Set(),
): Floater[] => {
  let out: Floater[] = []
  for (let h of similar(db, q, NET, floor)) {
    if (out.length == limit) break
    if (seen.has(h.eid)) continue
    if (!db.prepare('select 1 from memory where eid = ?').get(h.eid)) continue
    let row = db.prepare('select title from doc where eid = ?').get(h.eid) as
      | { title?: string }
      | undefined
    let title = String(row?.title ?? '').trim()
    if (title) {
      out.push({ id: human(db, h.eid), eid: h.eid, title, score: h.score })
    }
  }
  return out
}

// The whole door: text in, floaters out. A box with no embedder recalls nothing
// and says so with silence, never an error — exactly how the dupe hint degrades.
// The embedder is the one slow step, so it stays outside the pure core above.
export let recall = async (
  db: DatabaseSync,
  text: string,
  limit = 3,
  floor = RECALL,
  seen: Set<string> = new Set(),
): Promise<Floater[]> => {
  let vec = await embed(text)
  return vec ? recallFrom(db, vec, limit, floor, seen) : []
}

// A thought or two per message, never a search dump.
let FLOAT = 3

// The recall entry as a batch, pure: the entry in the session's partition, the
// floater text one memory per line, the `recalled` link back to the message
// that surfaced them, and a `recalled` edge per memory — the edges being the
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

// The effect (T-17306): a new message entry recalls memories into the session's
// OWN log — a durable `recalled` entry the channel then pushes (kind=recall) and
// a native session replays as part of its transcript. WHAT floats is recall()
// above; WHO sees it is the channel; this only writes the entry.
//
// Fires on `message` created only — new entries, never history — so deploying it
// touches messages from here forward, not the 110k already ingested. NO sweep:
// recall is best-effort ambient (a thought that missed its beat is simply gone,
// and the next message recalls anyway), and a sweep would try to re-embed every
// historical message on boot. A recall entry carries no `message` facet, so it
// never reaches this handler — recall cannot recall itself. The idempotency
// check keeps a double-fire from doubling a floater; the `recalled` edges let
// this session's earlier floaters screen the next (a memory twice is noise).
export let recallEntry =
  (cast: (c: Change[]) => void, recallFn = recall) => async (eid: string) => {
    let src = db.prepare('select session from entry where eid = ?').get(eid) as
      | { session?: string }
      | undefined
    let session = src?.session
    if (!session) return
    if (db.prepare('select 1 from recalled where source = ?').get(eid)) return
    let row = db.prepare('select body from content where eid = ?').get(eid) as
      | { body?: string }
      | undefined
    let text = String(row?.body ?? '').trim()
    if (!text) return
    let seen = new Set(
      (db.prepare(
        `select distinct d.child as child from dependency d
           join entry e on e.eid = d.parent
          where e.session = ? and d.type = 'recalled'`,
      ).all(session) as { child: string }[]).map((r) => r.child),
    )
    let floaters = await recallFn(db, text, FLOAT, RECALL, seen)
    if (floaters.length) cast(apply(db, writeRecall(session, eid, floaters)))
  }
