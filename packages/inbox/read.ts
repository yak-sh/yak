/** Server reads for the pure inbox policy. Membership and scalar projections
 * keep list reads bodyless; words are authoritative only in search/detail. */
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { tablesOf } from '@yaks/archetype/sets'
import {
  boundedReads,
  candidates,
  dependents,
  discussion,
  requirements,
  type Words,
  words,
} from './queries.ts'
import { type Reader, readerAt, type Row } from './reader.ts'
import { type Search, type Thread, threadOf, threads } from './threads.ts'

// Graph.read honors .fields before hydration; raw storage Tx.read does not.
type ReadTx = Pick<Graph, 'read' | 'get'>
type Vocabulary = Pick<Vocab, 'comp' | 'props'>
type Mode = 'metadata' | 'search' | 'detail'

// Presence is a policy fact, even when a component has no selected properties.
// In particular, an empty content marks a human input, and an empty decided,
// completed, conversation, requires or output still changes the policy.
let components = [
  'doc',
  'conversation',
  'content',
  'comment',
  'entry',
  'output',
  'notice',
  'reasoning',
  'result',
  'exception',
  'refusal',
  'ask',
  'call',
  'stop',
  'commit',
  'prompt',
  'session',
  'project',
  'design',
  'task',
  'decision',
  'filed',
  'mail',
  'mail_notice',
  'notified',
  'knock',
  'deliver',
  'signal',
  'bug',
  'created',
  'opened',
  'archived',
  'completed',
  'cancelled',
  'failed',
  'blocked',
  'broken',
  'resolved',
  'regressed',
  'decided',
  'exit',
  'requires',
  'edge',
]
let scalars = [
  'doc.title',
  'comment.target',
  'comment.reply_to',
  'entry.session',
  'entry.seq',
  'commit.target',
  'commit.at',
  'session.actor',
  'filed.assignee',
  'filed.project',
  'mail.at',
  'mail.from',
  'mail.to',
  'mail.target',
  'mail.message_id',
  'mail.reply_to',
  'notified.message_id',
  'knock.target',
  'deliver.to',
  'signal.target',
  'bug.title',
  'bug.app',
  'bug.first',
  'bug.last',
  'decision.question',
  'created.by',
  'created.at',
  'opened.by',
  'opened.at',
  'archived.at',
  'completed.at',
  'cancelled.at',
  'failed.at',
  'blocked.since',
  'broken.at',
  'resolved.at',
  'regressed.at',
  'decided.at',
  'decided.by',
  'decided.choice',
  'exit.at',
  'edge.from',
  'edge.to',
]
let rows = (bundles: Bundle[]): Row[] =>
  bundles.map((b) => ({
    eid: b.entity.eid,
    comps: Object.fromEntries(
      Object.entries(b).filter(([name, value]) =>
        name != 'entity' && value && typeof value == 'object'
      ),
    ) as Row['comps'],
  }))
let unique = (all: Row[]): Row[] => {
  let out = new Map<string, Row>()
  for (let row of all) {
    let prior = out.get(row.eid)
    out.set(row.eid, {
      eid: row.eid,
      comps: { ...prior?.comps, ...row.comps },
    })
  }
  return [...out.values()]
}
let ids = (all: Row[]) =>
  `.entity.eid=${JSON.stringify(all.map((r) => r.eid).join(','))}`
// Batches for identity lookups do not need stable subscription buckets.
let batches = (all: Row[]): Row[][] => {
  let out: Row[][] = []
  for (let i = 0; i < all.length; i += 256) out.push(all.slice(i, i + 256))
  return out
}
let membership = (query: string): string =>
  query.replace(/&\?\w+/g, '') + '&.fields=entity.eid'

let reads = (tx: ReadTx, has: Words, mode: Mode) => {
  let comps = components.filter(has)
  let fields = [
    'entity.eid',
    ...(has('entity.archetype') ? ['entity.archetype'] : []),
    ...scalars.filter(has),
    ...(mode == 'search' ? ['doc.body', 'content.body'].filter(has) : []),
  ].join(',')
  let descriptors = new Map<string, Set<string>>()
  // One computation owns one metadata working set. Overlapping discussion
  // arms must not hydrate the same entity repeatedly; never retain it across
  // reads, where another commit could change policy.
  let hydrated = new Map<string, Row>()
  let hydrate = async (members: Row[]): Promise<Row[]> => {
    let uniqueMembers = unique(members)
    let out: Row[] = []
    let missing = uniqueMembers.filter((r) => !hydrated.has(r.eid))
    for (let part of batches(missing)) {
      if (mode == 'detail') {
        out.push(...rows(await tx.get(part.map((r) => r.eid), comps)))
        continue
      }
      let projectedRows = await tx.read(`${ids(part)}&.fields=${fields}`)
      let projected = new Map(rows(projectedRows).map((r) => [r.eid, r]))
      let spines = has('entity.archetype')
        ? projectedRows
        : await tx.get(part.map((r) => r.eid), [])
      let unknown = [
        ...new Set(
          spines.map((b) => b.entity.archetype)
            .filter((id): id is string =>
              typeof id == 'string' && !descriptors.has(id)
            ),
        ),
      ]
      for (
        let b of unknown.length ? await tx.get(unknown, ['archetype']) : []
      ) {
        descriptors.set(
          b.entity.eid,
          new Set(tablesOf((b.archetype as Comp)?.tables)),
        )
      }
      let classified = new Set<string>()
      for (let b of spines) {
        let tables = descriptors.get(String(b.entity.archetype ?? ''))
        if (!tables) continue
        classified.add(b.entity.eid)
        let r = projected.get(b.entity.eid)
        if (!r) {
          r = { eid: b.entity.eid, comps: {} }
          projected.set(r.eid, r)
        }
        for (let comp of comps) if (tables.has(comp)) r.comps[comp] ??= {}
      }
      // A projection cannot tell absent from present-with-no-selected-values.
      // Ask membership only for the components it did not carry; no body is
      // read merely to prove that doc/content (or a zero-property mark) exists.
      for (let comp of comps) {
        let missing = part.filter((r) =>
          !classified.has(r.eid) && !projected.get(r.eid)?.comps[comp]
        )
        if (!missing.length) continue
        for (
          let b of await tx.read(
            `.${comp}&${ids(missing)}&.fields=entity.eid`,
          )
        ) {
          let r = projected.get(b.entity.eid)
          if (!r) {
            r = { eid: b.entity.eid, comps: {} }
            projected.set(r.eid, r)
          }
          r.comps[comp] = {}
        }
      }
      out.push(...projected.values())
    }
    for (let row of out) hydrated.set(row.eid, row)
    return uniqueMembers.flatMap((r) =>
      hydrated.has(r.eid) ? [hydrated.get(r.eid)!] : []
    )
  }
  let read = async (queries: string[]): Promise<Row[]> => {
    let members: Row[] = []
    for (let q of new Set(queries.filter(Boolean))) {
      members.push(...rows(await tx.read(membership(q))))
    }
    return hydrate(members)
  }
  return { read, hydrate }
}

let reader = async (
  tx: ReadTx,
  has: Words,
  actor: string,
): Promise<Reader> => {
  let fields = [
    'entity.eid',
    'email.address',
    'subscription.actor',
    'subscription.target',
    'subscription.mode',
  ].filter(has).join(',')
  let person = rows(
    await tx.read(
      `.entity.eid=${JSON.stringify(actor)}&.fields=${fields}`,
    ),
  )
  if (has('project')) {
    for (
      let r of rows(
        await tx.read(
          `.project&.entity.eid=${JSON.stringify(actor)}&.fields=entity.eid`,
        ),
      )
    ) {
      let p = person.find((p) => p.eid == r.eid)
      if (p) p.comps.project = {}
      else person.push({ eid: r.eid, comps: { project: {} } })
    }
  }
  let subs = has('subscription.actor')
    ? rows(
      await tx.read(
        `.subscription.actor=${JSON.stringify(actor)}&.fields=${fields}`,
      ),
    )
    : []
  return readerAt([...person, ...subs], actor)
}

let index = (all: Row[]): Map<string, Row> => {
  let byId = new Map(
    all.filter((r) => !r.comps.mail_notice).map((r) => [r.eid, r]),
  )
  for (let r of byId.values()) {
    for (let id of [r.comps.mail?.message_id, r.comps.notified?.message_id]) {
      if (id) byId.set(String(id), r)
    }
  }
  return byId
}

/** Expand roots and reply ancestry to a fixed point. Mail replies may name a
 * message-id rather than an eid, and more than one ancestor can be missing. */
let conversation = async (
  seed: Row[],
  who: Reader,
  has: Words,
  read: ReturnType<typeof reads>['read'],
  search: Search,
): Promise<Row[]> => {
  let all = unique(seed)
  let queriedRoots = new Set<string>(), queriedParents = new Set<string>()
  let queriedReplies = new Set<string>()
  for (;;) {
    let byId = index(all)
    let roots = [...new Set(all.map((r) => threadOf(r, who, byId)))]
      .filter((eid) => !queriedRoots.has(eid))
      .map((eid) => ({ eid, comps: {} }))
    roots.forEach((r) => queriedRoots.add(r.eid))
    let queries = boundedReads(roots, (part) => discussion(part, has, search))
    let parents = [
      ...new Set(all.map((r) => String(r.comps.mail?.reply_to ?? ''))),
    ]
      .filter((eid) => eid && !queriedParents.has(eid))
      .map((eid) => ({ eid, comps: {} }))
    parents.forEach((r) => queriedParents.add(r.eid))
    queries.push(...boundedReads(parents, (part) => {
      let refs = JSON.stringify(part.map((r) => r.eid).join(','))
      return [
        `.entity.eid=${refs}`,
        ...['mail.message_id', 'notified.message_id'].filter(has)
          .map((p) => `.${p}=${refs}`),
      ].map((q) => `(${q})`).join('|')
    }))
    if (has('mail.reply_to')) {
      let replies = [
        ...new Set(
          all.filter((r) => r.comps.mail || r.comps.notified).flatMap((r) => [
            r.eid,
            r.comps.mail?.message_id,
            r.comps.notified?.message_id,
          ]).filter((id): id is string => typeof id == 'string' && !!id),
        ),
      ]
        .filter((id) => !queriedReplies.has(id))
        .map((eid) => ({ eid, comps: {} }))
      replies.forEach((r) => queriedReplies.add(r.eid))
      queries.push(
        ...boundedReads(
          replies,
          (part) =>
            `.mail.reply_to=${
              JSON.stringify(part.map((r) => r.eid).join(','))
            }`,
        ),
      )
    }
    if (!queries.length) return all
    let more = await read(queries)
    all = unique([...all, ...more])
  }
}

/** Exact server inbox summaries. Bodies are absent, not truncated previews.
 * Text/direction searches read complete words on the server, then apply the
 * same pure policy; callers receive threads rather than the source history. */
export let readInbox = async (
  tx: ReadTx,
  vocab: Vocabulary,
  actor: string,
  search: Search = {},
): Promise<Thread[]> => {
  let txGet = tx.get.bind(tx), txRead = tx.read.bind(tx)
  tx = {
    get: (ids, comps) => txGet(ids, comps, { native: true }),
    read: (q) => txRead(q, { native: true }),
  }
  let has = words(vocab)
  let who = await reader(tx, has, actor)
  let { read } = reads(
    tx,
    has,
    search.text?.trim() || search.direction ? 'search' : 'metadata',
  )
  let first = await read([candidates(who, has)])
  let all = await conversation(first, who, has, read, search)
  let byId = index(all)
  let roots = [...new Set(all.map((r) => threadOf(r, who, byId)))]
    .map((eid) => ({ eid, comps: {} }))
  let edges = await read(boundedReads(roots, (part) => requirements(part, has)))
  let tasks = await read(boundedReads(edges, (part) => dependents(part, has)))
  return threads(unique([...all, ...edges, ...tasks]), who, search)
}

/** Full authoritative words and messages for one thread, including archived
 * threads. Digest/detail callers must opt into this read rather than treating
 * metadata as a body. Missing or muted/non-inbox roots return undefined. */
export let readThread = async (
  tx: ReadTx,
  vocab: Vocabulary,
  actor: string,
  root: string,
): Promise<Thread | undefined> => {
  let txGet = tx.get.bind(tx), txRead = tx.read.bind(tx)
  tx = {
    get: (ids, comps) => txGet(ids, comps, { native: true }),
    read: (q) => txRead(q, { native: true }),
  }
  let has = words(vocab)
  let who = await reader(tx, has, actor)
  let { read, hydrate } = reads(tx, has, 'detail')
  let seed = await hydrate([{ eid: root, comps: {} }])
  if (!seed.length) return undefined
  // Direction forces discussion() to include internal transcript words too;
  // it is not passed to the policy, which still computes ordinary attention.
  let all = await conversation(seed, who, has, read, { direction: 'received' })
  let eid = threadOf(seed[0], who, index(all))
  let metadata = reads(tx, has, 'metadata').read
  let edges = await metadata([requirements([{ eid, comps: {} }], has)])
  let tasks = await metadata(
    boundedReads(edges, (part) => dependents(part, has)),
  )
  return threads(unique([...all, ...edges, ...tasks]), who, { all: true })
    .find((t) => t.eid == eid)
}
