/**
 * The graph as a case's agent stood in it: the boundary that reads what a
 * variant put in front of the agent before its entry, and what a search with
 * the words it was answering finds, for {@link trial} to score.
 *
 * Everything here reads through a generic {@link Reads} and a {@link Search},
 * so a test hands it a graph in memory and the box hands it its own.
 *
 * The moment is the erring entry's `created.at`. {@link asOf} keeps the rows
 * created before it and the marks stamped before it, and computes each status
 * from what is left. The store keeps no versions, so a body edited since reads
 * as it reads now.
 *
 * What was in front of the agent is its persona as the variant has it at that
 * moment, and, from its session since the latest compaction before the entry:
 * the compaction summary, each notice, each entity a knock delivered through
 * it (`notified{via}`), and each `hit` row a write of its returned. Its own
 * searches and reads are left out: they were asked for.
 *
 * @module
 */
import type { Bundle, Eid, Storage } from '@yaks/graph'
import type { Search } from '@yaks/graph/tools'
import { and, eq, gt, lt, present } from '@yaks/query'
import { statusOf } from '@yaks/match'
import { voice, wear } from '@yaks/persona'
import type { Vocab } from '@yaks/vocab'
import { type Case, type Part, trial } from './mod.ts'

/** What gathering reads of a storage: queries, and entities by eid. */
export type Reads = Pick<Storage, 'read' | 'get'>

type Comp = Record<string, unknown>
let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''
let createdAt = (b: Bundle): string => str(comp(b, 'created').at)
let text = (b: Bundle): string =>
  str(comp(b, 'content').body) || str(comp(b, 'doc').body) ||
  str(comp(b, 'doc').title)

/** A bundle as it stood at `at`: undefined when it was created later, and
 * otherwise without the marks stamped since, each status read again from the
 * marks that are left. */
export let before =
  (vocab: Vocab, at: string) => (b: Bundle): Bundle | undefined => {
    let born = createdAt(b)
    if (born && born >= at) return undefined
    let kept: Bundle = { entity: b.entity }
    for (let [name, value] of Object.entries(b)) {
      if (name == 'entity') continue
      let stamped = str((value as Comp | null)?.at)
      if (name != 'created' && stamped && stamped >= at) continue
      kept[name] = value
    }
    for (let name of Object.keys(kept)) {
      if (!vocab.comp(name)?.ladder) continue
      let { status: _, ...own } = comp(kept, name)
      let bare = { ...kept, [name]: own }
      kept[name] = { ...own, status: statusOf(vocab, name, bare) }
    }
    return kept
  }

let past = (
  vocab: Vocab,
  at: string,
): (rows: Bundle[]) => Bundle[] =>
(rows) => rows.flatMap((b) => before(vocab, at)(b) ?? [])

/** A storage as it stood at `at`. A filter is matched against the row as it
 * is now, then the row is cut back: a query on a status reads today's. */
export let asOf = (storage: Reads, vocab: Vocab, at: string): Reads => {
  let cut = past(vocab, at)
  return {
    read:
      (async (q: Parameters<Reads['read']>[0]) =>
        cut(await storage.read(q))) as Reads['read'],
    get: (async (eids: Eid[]) => cut(await storage.get(eids))) as Reads['get'],
  }
}

/** The erring entry a case names, as the trial needs it. */
export type Moment = { entry: Eid; session: Eid; seq: number; at: string }

/** Where a case's entry stands: its session, its place and its time. */
export let moment = async (
  storage: Reads,
  entry: Eid,
): Promise<Moment | undefined> => {
  let [b] = await storage.get([entry])
  let e = comp(b, 'entry')
  if (!b || typeof e.session != 'string' || typeof e.seq != 'number') return
  return { entry, session: e.session, seq: e.seq, at: createdAt(b) }
}

// What a model turn answers: words someone wrote to the agent, a person's
// input or the brief it was spawned with. Harness text (a notice, a skill
// loaded, a child's delivery) and the agent's own entries have no author.
let own = ['output', 'call', 'result', 'reasoning', 'ask', 'checkpoint']
/** Whether an entry is words someone wrote to the agent. */
export let prompt = (b: Bundle): boolean =>
  !own.some((c) => b[c]) && !!str(comp(b, 'created').by) && !!text(b).trim()

let seqOf = (b: Bundle): number => Number(comp(b, 'entry').seq ?? 0)

/** The hit rows a write's result carries: bundles wearing a `hit` that names
 * the entity it was found near. A search's hits name none, and were asked
 * for. */
export let hits = (b: Bundle): Bundle[] => {
  let body = text(b)
  if (!b.result || !body.startsWith('{')) return []
  try {
    let rows = JSON.parse(body)?.result
    return Array.isArray(rows)
      ? rows.filter((r: Bundle) => r?.entity && comp(r, 'hit').near)
      : []
  } catch {
    return []
  }
}

/** The session's entries the agent had at its moment: from the latest
 * compaction before the entry up to it, in order. */
export let window = async (storage: Reads, m: Moment): Promise<Bundle[]> => {
  let { session, seq } = m
  let cuts = await storage.read(and(
    eq('entry.session', session),
    present('checkpoint'),
    lt('entry.seq', seq),
  ))
  let from = Math.max(0, ...cuts.map(seqOf))
  let rows = await storage.read(and(
    eq('entry.session', session),
    gt('entry.seq', from - 1),
    lt('entry.seq', seq),
  ))
  return rows.toSorted((a, b) => seqOf(a) - seqOf(b))
}

/** Where a variant stands when it adds to a door: the case's moment, the
 * session's entries the agent had then, and when they begin (the session's
 * start or its latest compaction). */
export type At = {
  storage: Reads
  vocab: Vocab
  m: Moment
  had: Bundle[]
  since: string
}

/** What a variant adds at a door beyond its persona (./arrive.ts): rows a
 * saved query or a recall would have put in front of the agent. */
export type Arrival = (at: At) => Promise<Part[]>

/** What the persona put in front of the agent before its entry, door by
 * door, and what each arrival adds. */
export let front = async (
  storage: Reads,
  vocab: Vocab,
  persona: Eid,
  m: Moment,
  arrivals: Arrival[] = [],
): Promise<Part[]> => {
  let then = asOf(storage, vocab, m.at)
  let worn = await wear(then, vocab)(persona)
  let had = await window(storage, m)
  let since = createdAt(had[0] ?? { entity: { eid: '' } }) || m.at
  let knocked = (await then.read(and(
    eq('notified.via', m.session),
    gt('notified.at', since),
  ))).filter((b) => !!str(comp(b, 'notified').at))
  let part = (door: Part['door'], rows: Bundle[]): Part[] =>
    rows.length
      ? [{
        door,
        eids: rows.map((b) => b.entity.eid),
        text: rows.map(text).join('\n'),
      }]
      : []
  let returned = had.flatMap(hits)
  return [
    ...worn
      ? [{
        door: 'persona' as const,
        eids: [worn.persona, ...worn.contains].map((b) => b.entity.eid),
        text: voice(vocab)(worn),
      }]
      : [],
    ...part('compaction', had.filter((b) => b.checkpoint)),
    ...part('notice', had.filter((b) => b.notice)),
    ...part('knock', knocked),
    ...returned.length
      ? [{
        door: 'hit' as const,
        eids: returned.map((b) => b.entity.eid),
        text: returned.map((b) => JSON.stringify(b.hit)).join('\n'),
      }]
      : [],
    ...(await Promise.all(
      arrivals.map((a) => a({ storage, vocab, m, had, since })),
    )).flat(),
  ]
}

/** How many of a message's words a search is asked: an agent searches with a
 * phrase, not a page, and a page of words takes the search seconds. */
export let WORDS = 12

/** The words of the message the agent was answering: the first
 * {@link WORDS} of the latest words someone wrote to it before its entry. */
export let asking = (had: Bundle[]): string =>
  (text(had.findLast(prompt) ?? { entity: { eid: '' } })
    .match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).slice(0, WORDS).join(' ')

/** What a search with these words finds of the graph as it stood at the
 * moment, best first. */
export let found = async (
  storage: Reads,
  vocab: Vocab,
  search: Search,
  words: string,
  at: string,
): Promise<Eid[]> => {
  if (!words.trim()) return []
  let ranked = (await search(words, { limit: 20 })).map((b) => b.entity.eid)
  let held = new Set(
    (await asOf(storage, vocab, at).get(ranked)).map((b) => b.entity.eid),
  )
  return ranked.filter((e) => held.has(e))
}

/** The cases the graph holds: every entity wearing a miss. */
export let cases = async (
  storage: Reads,
): Promise<(Case & { entry: Eid })[]> =>
  (await storage.read(and(present('miss')))).flatMap((b) => {
    let m = comp(b, 'miss')
    if (typeof m.entry != 'string') return []
    return [{
      eid: b.entity.eid,
      entry: m.entry,
      ...typeof m.needed == 'string' ? { needed: m.needed } : {},
    }]
  })

/** A variant that adds to the doors: the persona its rows are written under,
 * which says what it adds, and the arrivals that add it. Each case wears its
 * session's own persona beneath them. */
export type Adding = { as: Eid; arrivals: Arrival[] }

/** Score one case under a variant: a persona, an {@link Adding}, or, when none
 * is named, the persona its session wore. Undefined when its entry is not in
 * the graph. */
export let run = async (
  storage: Reads,
  vocab: Vocab,
  search: Search,
  c: Case & { entry: Eid },
  variant?: Eid | Adding,
): Promise<Bundle | undefined> => {
  let m = await moment(storage, c.entry)
  if (!m) return
  let [session] = await storage.get([m.session])
  let persona = typeof variant == 'string'
    ? variant
    : str(comp(session, 'session').persona)
  if (!persona) return
  let adding = typeof variant == 'object' ? variant : undefined
  let had = await window(storage, m)
  return trial(
    c,
    adding?.as ?? persona,
    await front(storage, vocab, persona, m, adding?.arrivals),
    await found(storage, vocab, search, asking(had), m.at),
  )
}
