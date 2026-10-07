import { type Reader, type Row } from './reader.ts'
import type { Search } from './threads.ts'
import { threadOf } from './threads.ts'

/** Optional words are queried only when the host declares them. */
export type Words = (path: string) => boolean
/** A vocabulary is data: consumers provide only its component/property lookup. */
export let words = (
  vocab: {
    comp: (name: string) => unknown
    props: (name: string) => string[]
  },
): Words =>
(path) => {
  let [name, prop] = path.split('.')
  return path == 'entity.eid' ||
    (!!vocab.comp(name) && (!prop || vocab.props(name).includes(prop)))
}
let value = (items: Iterable<string | undefined>) =>
  JSON.stringify([...new Set([...items].filter(Boolean))].sort().join(','))
let select = (prop: string, items: Iterable<string | undefined>) => {
  let v = value(items)
  return v == '""' ? '' : `.${prop}=${v}`
}
let union = (arms: string[], has: Words) =>
  arms.filter((q) => q && has(q.slice(1).split(/[&=]/)[0])).map((q) => `(${q})`)
    .join('|')
// Explicit optional components preserve sparse host vocabularies, and include
// message bodies for said/received search. No unrelated delivery job payloads.
let fields = [
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
let read = (q: string, has: Words) =>
  q ? `(${q})` + fields.filter(has).map((s) => `&?${s}`).join('') : ''

/** First read: direct address, assigned work, watched work and attention. */
export let candidates = (who: Reader, has: Words = () => true): string => {
  let targets = [
    who.actor,
    who.session,
    ...who.claims ?? [],
    ...who.watching ?? [],
  ]
  let authored = select('created.by', [who.actor])
  let kinds = [
    'doc',
    'conversation',
    'task',
    'session',
    'design',
    'bug',
    'mail',
    'mail_notice',
    'comment',
    'entry',
  ].filter(has).map((name) => `.${name}`).join('|')
  if (authored && kinds) authored += `&(${kinds})`
  return read(
    union([
      select('comment.target', targets),
      select('signal.target', targets),
      select('deliver.to', [who.actor, who.session]),
      select('mail.to', who.addrs ?? []),
      select('mail.from', who.addrs ?? []),
      select('mail.target', [who.scope, who.session, ...who.watching ?? []]),
      select('filed.assignee', [who.actor]),
      authored,
      select('opened.by', [who.actor]),
      select('decided.by', [who.actor]),
      select('session.actor', [who.actor]),
      select('entity.eid', who.watching ?? []),
      who.actor && who.operator ? '.bug' : '',
      who.actor && who.operator ? '.decision' : '',
    ], has),
    has,
  )
}

// The lane policy consumes human inputs, visible answers and state changes.
// Model attempts, tools, reasoning and passive notices do not enter messages,
// latest, activity or attention. Text/direction search still sees all words.
let activityEntries = (has: Words): string => {
  let input = has('content')
    ? '.content' +
      [
        'output',
        'prompt',
        'notice',
        'result',
        'refusal',
        'exception',
        'ask',
        'call',
      ]
        .filter(has).map((name) => `&!${name}`).join('')
    : ''
  let output = has('output')
    ? '.output' + (has('reasoning') ? '&!reasoning' : '')
    : ''
  return [
    input,
    output,
    ...['exception', 'refusal', 'stop'].filter(has).map((name) => `.${name}`),
  ]
    .filter(Boolean).map((line) => `(${line})`).join('|')
}

/** Second read: complete roots and policy-relevant conversation. Searches
 * additionally read words that the attention policy does not otherwise use. */
export let discussion = (
  rows: Row[],
  has: Words = () => true,
  search: Search = {},
): string => {
  let targets = rows.filter((r) => !r.comps.edge && !r.comps.subscription).map(
    (r) => threadOf(r),
  )
  let entries = select('entry.session', targets)
  let activity = activityEntries(has)
  if (entries && !search.text?.trim() && !search.direction && activity) {
    entries += `&(${activity})`
  }
  return read(
    union([
      select('entity.eid', [
        ...targets,
        ...rows.map((r) => String(r.comps.mail?.reply_to ?? '')),
      ]),
      select(
        'mail.message_id',
        rows.map((r) => String(r.comps.mail?.reply_to ?? '')),
      ),
      select('comment.target', targets),
      select('mail.target', targets),
      select('knock.target', targets),
      entries,
      select('commit.target', targets),
    ], has),
    has,
  )
}

/** Third/fourth reads: requires edges and their dependent task state. */
export let requirements = (rows: Row[], has: Words = () => true): string =>
  has('requires') && has('edge')
    ? read(
      select('edge.to', rows.map((r) => threadOf(r))) +
        (rows.length ? '&.requires' : ''),
      has,
    )
    : ''
export let dependents = (edges: Row[], has: Words = () => true): string =>
  read(
    select('entity.eid', edges.map((r) => String(r.comps.edge?.from ?? ''))),
    has,
  )

/** Keep derived inbox reads below the socket's message budget without dropping
 * threads. Each half asks the same query over a disjoint set of input rows;
 * callers union the answers and wait for every half before claiming readiness.
 */
export let boundedReads = (
  rows: Row[],
  read: (rows: Row[]) => string,
): string[] => {
  let out = new Set<string>()
  let split = (part: Row[]) => {
    let query = read(part)
    if (!query) return
    // Leave room for the subscription envelope, including escaped query text.
    if (new TextEncoder().encode(JSON.stringify(query)).length <= 48 * 1024) {
      out.add(query)
      return
    }
    if (part.length < 2) throw new RangeError('inbox row exceeds query budget')
    let middle = Math.floor(part.length / 2)
    split(part.slice(0, middle))
    split(part.slice(middle))
  }
  // Identity-based buckets keep unrelated reads byte-for-byte stable when a
  // root is added or removed. Array-midpoint splitting shifts every boundary.
  let buckets: Row[][] = Array.from({ length: 16 }, () => [])
  let bucket = (id: string) => {
    let hash = 2166136261
    for (let c of id) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619)
    return (hash >>> 0) % buckets.length
  }
  for (let row of rows.toSorted((a, b) => a.eid.localeCompare(b.eid))) {
    buckets[bucket(row.eid)].push(row)
  }
  for (let part of buckets) if (part.length) split(part)
  return [...out]
}

/** One input per thread before splitting derived reads. Repeating a session
 * across disjoint batches would download that session's whole discussion in
 * each batch, even though the caller unions the same rows afterward. */
export let threadRoots = (rows: Row[]): Row[] => {
  let roots = new Map<string, Row>()
  for (let row of rows) {
    let id = threadOf(row)
    let prior = roots.get(id)
    if (!prior || row.eid == id) roots.set(id, row)
  }
  return [...roots.values()]
}

export let summaryQuery = (
  actor: string,
  search: Search = {},
  thread?: string,
): string =>
  `.inbox_summary.actor=${JSON.stringify(actor)}` +
  (search.text ? `&.inbox_summary.text=${JSON.stringify(search.text)}` : '') +
  (search.direction ? `&.inbox_summary.direction=${search.direction}` : '') +
  (search.all ? '&.inbox_summary.all=true' : '') +
  (search.lane ? `&.inbox_summary.lane=${JSON.stringify(search.lane)}` : '') +
  (thread ? `&.inbox_summary.thread=${JSON.stringify(thread)}` : '')
