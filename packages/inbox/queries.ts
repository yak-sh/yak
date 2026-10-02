import { type Reader, type Row } from './reader.ts'
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

/** Second read: complete roots and conversation, including archived activity. */
export let discussion = (rows: Row[], has: Words = () => true): string => {
  let targets = rows.filter((r) => !r.comps.edge && !r.comps.subscription).map(
    (r) => threadOf(r),
  )
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
      select('entry.session', targets),
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
