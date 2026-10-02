// Query ownership belongs to the mounted door; attention policy is pure.
import {
  activityAt,
  readerAt,
  type Search,
  type Thread,
  threads,
} from '@yaks/inbox'
import {
  candidates,
  dependents,
  discussion,
  requirements,
  words,
} from '@yaks/inbox/queries'
import { isUnread, type Row, uniq } from '../client.ts'
import { inbox as seededInbox, row } from '../live.ts'
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
  let conversation = useQueryResult(
    discussion(first, has),
    ready && authoritative(seed),
    true,
  )
  let group = uniq([...first, ...rows(conversation.eids)])
  let edges = useQueryResult(
    requirements(group, has),
    ready && authoritative(seed) && authoritative(conversation),
    true,
  )
  let tasks = useQueryResult(
    dependents(rows(edges.eids), has),
    ready && authoritative(edges),
    true,
  )
  return {
    threads: threads(
      uniq([...group, ...rows(edges.eids), ...rows(tasks.eids)]),
      who,
      search,
    ),
    ready: ready && authoritative(seed) && authoritative(conversation) &&
      authoritative(edges) &&
      authoritative(tasks),
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
