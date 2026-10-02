// Query ownership belongs to the mounted door; attention policy is pure.
import {
  activityAt,
  readerAt,
  type Search,
  type Thread,
  threads,
} from '@yaks/inbox'
import {
  boundedReads,
  candidates,
  dependents,
  discussion,
  requirements,
  words,
} from '@yaks/inbox/queries'
import { isUnread, type Row, uniq } from '../client.ts'
import {
  dropQuery,
  holdQuery,
  inbox as seededInbox,
  queryEids,
  querySubscription,
  row,
} from '../live.ts'
import { useLayoutEffect, useMemo } from 'preact/hooks'
import { parseQuery, resolveRefs } from '../query.ts'
import { findEid } from '../live.ts'
import { kindOf, vocab } from '../types.ts'
import { type QueryResult, useQueryResult } from './useQuery.ts'
import { useEntity } from './subscriptions.ts'

let rows = (eids: string[]): Row[] =>
  eids.flatMap((eid) => {
    let comps = row(eid).value
    return comps
      ? [{
        eid,
        num: Number(comps.entity?.num ?? 0),
        kind: kindOf(comps),
        comps: comps as Row['comps'],
      }]
      : []
  })
let has = words(vocab)

let authoritative = (r: QueryResult) =>
  r.ready && r.subscription?.state.status != 'failed'

// The number of derived reads may change; one hook owns all their lifetimes.
let useReads = (queries: string[], enabled: boolean) => {
  let key = JSON.stringify(queries)
  let reads = useMemo(() =>
    queries.map((line) => ({
      line,
      preds: resolveRefs(parseQuery(line), findEid),
    })), [key])
  useLayoutEffect(() => {
    if (!enabled) return
    for (let { preds, line } of reads) holdQuery(preds, line)
    return () => {
      for (let { preds } of reads) dropQuery(preds)
    }
  }, [reads, enabled])
  let eids = new Set<string>()
  let ready = enabled
  if (enabled) {
    for (let { preds, line } of reads) {
      let sub = querySubscription(preds, line)
      ready &&= !sub || sub.state.status == 'ready'
      for (let eid of queryEids(preds, line).value) eids.add(eid)
    }
  }
  return { eids: [...eids], ready }
}

/** Complete query-derived thread data for web, TUI and the inbox root screen. */
export let useInboxThreads = (
  actor: string,
  search: Search = {},
): { threads: Thread<Row>[]; ready: boolean } => {
  let fields = ['project.color', 'email.address'].filter(has).join(',')
  let profile = useEntity(actor, fields || 'entity.eid')
  let subscriptions = useQueryResult(
    has('subscription') ? `.subscription.actor=${actor}` : '',
  )
  let who = readerAt([
    ...(profile?.value ? rows([actor]) : []),
    ...rows(subscriptions.eids),
  ], actor)
  let ready = profile?.ready === true && authoritative(subscriptions)
  let seed = useQueryResult(candidates(who, has), ready, true)
  let first = rows(seed.eids)
  let conversation = useReads(
    boundedReads(first, (part) => discussion(part, has)),
    ready && authoritative(seed),
  )
  let group = uniq([...first, ...rows(conversation.eids)])
  let edges = useReads(
    boundedReads(group, (part) => requirements(part, has)),
    ready && authoritative(seed) && conversation.ready,
  )
  let tasks = useReads(
    boundedReads(rows(edges.eids), (part) => dependents(part, has)),
    ready && edges.ready,
  )
  return {
    threads: threads(
      uniq([...group, ...rows(edges.eids), ...rows(tasks.eids)]),
      who,
      search,
    ),
    ready: ready && authoritative(seed) && conversation.ready &&
      edges.ready && tasks.ready,
  }
}

export type InboxRow = Row & { inbox?: Thread<Row> }

// Existing embedded list consumes roots; T-64033 consumes the full thread API.
export let useInbox = (actor: string, unreadOnly = false): InboxRow[] => {
  let seeded = seededInbox(actor)
  let found = useInboxThreads(actor)
  if (seeded.length) {
    return (unreadOnly ? seeded.filter(isUnread) : [...seeded]).sort((a, b) =>
      activityAt(b).localeCompare(activityAt(a))
    )
  }
  return found.threads.filter((t) => !unreadOnly || t.unread).map((t) => {
    let comps = { ...t.row.comps }
    if (t.unread) delete comps.opened
    else comps.opened ??= {}
    return { ...t.row, comps, inbox: t }
  })
}

/** Counts use the same threads, archive boundary and unread time as the list. */
export let useInboxCount = (actor: string): number | undefined => {
  let seeded = seededInbox(actor)
  let found = useInboxThreads(actor)
  if (seeded.length) return seeded.filter(isUnread).length
  return found.ready ? found.threads.filter((t) => t.unread).length : undefined
}
