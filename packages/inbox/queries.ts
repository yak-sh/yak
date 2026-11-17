import { type Built, joined, line, sub } from '@yaks/query'
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
): Words => {
  let known = new Map<string, boolean>()
  return (path) => {
    let yes = known.get(path)
    if (yes !== undefined) return yes
    let [name, prop] = path.split('.')
    yes = path == 'entity.eid' ||
      (!!vocab.comp(name) && (!prop || vocab.props(name).includes(prop)))
    known.set(path, yes)
    return yes
  }
}
let NONE = line``
// Each set of values is sorted, so the same set always reads as one line.
let select = (prop: string, items: Iterable<string | undefined>): Built => {
  let v = [...new Set([...items].filter((i): i is string => !!i))].sort()
  return v.length ? line`.${prop}=${v}` : NONE
}
// Lines one after another, each joined to the one before by `by`.
let chain = (all: Built[], by: (a: Built, b: Built) => Built): Built =>
  all.reduce<Built>((a, l) => a ? by(a, l) : l, NONE)
let bar = (all: Built[]) => chain(all, (a, b) => line`${sub(a)}|${sub(b)}`)
let union = (arms: Built[], has: Words) =>
  joined(arms.filter((q) => q && has(q.slice(1).split(/[&=]/)[0])), '|')
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
  'notification',
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
let read = (q: Built, has: Words): Built =>
  q
    ? fields.filter(has).reduce<Built>(
      (l, s) => line`${sub(l)}&?${s}`,
      line`(${sub(q)})`,
    )
    : NONE

/** First read: direct address, assigned work, watched work and attention,
 * of only the components `within` names when it names any. */
export let candidates = (
  who: Reader,
  has: Words = () => true,
  within?: string[],
): Built => {
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
  ].filter(has).map((name) => line`.${name}`)
  let kind = bar(kinds)
  if (authored && kind) authored = line`${sub(authored)}&(${sub(kind)})`
  let arms = union([
    select('comment.target', targets),
    select('deliver.to', [who.actor, who.session, who.scope]),
    select('mail.to', who.addrs ?? []),
    select('mail.from', who.addrs ?? []),
    select('mail.target', [who.scope, who.session, ...who.watching ?? []]),
    select('filed.assignee', [who.actor]),
    authored,
    select('entity.eid', who.attention?.keys() ?? []),
    select('decided.by', [who.actor]),
    select('session.actor', [who.actor]),
    select('entity.eid', who.watching ?? []),
    who.actor && who.operator ? line`.bug` : NONE,
    who.actor && who.operator ? line`.decision` : NONE,
  ], has)
  if (!within || !arms) return read(arms, has)
  let held = union(within.map((name) => line`.${name}`), has)
  return held ? read(line`(${sub(arms)})&(${sub(held)})`, has) : NONE
}

// The lane policy consumes human inputs, visible answers and state changes.
// Model attempts, tools, reasoning and passive notices do not enter messages,
// latest, activity or attention. Text/direction search still sees all words.
let activityEntries = (has: Words): Built => {
  let input = has('content')
    ? [
      'output',
      'prompt',
      'notice',
      'result',
      'refusal',
      'exception',
      'ask',
      'call',
    ]
      .filter(has).reduce<Built>(
        (l, name) => line`${sub(l)}&!${name}`,
        line`.content`,
      )
    : NONE
  let output = has('output')
    ? has('reasoning') ? line`.output&!reasoning` : line`.output`
    : NONE
  return joined(
    [
      input,
      output,
      ...['exception', 'refusal', 'stop'].filter(has).map((name) =>
        line`.${name}`
      ),
    ].filter(Boolean),
    '|',
  )
}

/** Second read: complete roots and policy-relevant conversation. Searches
 * additionally read words that the attention policy does not otherwise use. */
export let discussion = (
  rows: Row[],
  has: Words = () => true,
  search: Search = {},
): Built => {
  let targets = rows.filter((r) => !r.comps.edge && !r.comps.subscription).map(
    (r) => threadOf(r),
  )
  let entries = select('entry.session', targets)
  let activity = activityEntries(has)
  if (entries && !search.text?.trim() && !search.direction && activity) {
    entries = line`${sub(entries)}&(${sub(activity)})`
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
export let requirements = (rows: Row[], has: Words = () => true): Built =>
  has('requires') && has('edge')
    ? read(
      rows.length
        ? line`${
          sub(select('edge.to', rows.map((r) => threadOf(r))))
        }&.requires`
        : NONE,
      has,
    )
    : NONE
export let dependents = (edges: Row[], has: Words = () => true): Built =>
  read(
    select('entity.eid', edges.map((r) => String(r.comps.edge?.from ?? ''))),
    has,
  )

const BUDGET = 48 * 1024

/** Keep derived inbox reads below the socket's message budget without dropping
 * threads. Each half asks the same query over a disjoint set of input rows;
 * callers union the answers and wait for every half before claiming readiness.
 */
export let boundedReads = (
  rows: Row[],
  read: (rows: Row[]) => Built,
): Built[] => {
  let out = new Set<Built>()
  let split = (part: Row[]) => {
    let query = read(part)
    if (!query) return
    // Leave room for the subscription envelope, including escaped query text.
    // A character is at most three bytes, so a short query needs no count.
    let text = JSON.stringify(query)
    if (
      text.length * 3 <= BUDGET ||
      new TextEncoder().encode(text).length <= BUDGET
    ) {
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
): Built =>
  line`.inbox_summary.actor=${actor}${
    sub(search.text ? line`&.inbox_summary.text=${search.text}` : NONE)
  }${
    sub(
      search.direction
        ? line`&.inbox_summary.direction=${search.direction}`
        : NONE,
    )
  }${sub(search.all ? line`&.inbox_summary.all=true` : NONE)}${
    sub(search.lane ? line`&.inbox_summary.lane=${search.lane}` : NONE)
  }${sub(thread ? line`&.inbox_summary.thread=${thread}` : NONE)}`
