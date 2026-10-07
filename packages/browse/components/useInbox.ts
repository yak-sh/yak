// The inbox policy is computed by its server-owned summary read. The page
// holds just summaries and rows it draws; history bodies load with detail.
import { activityAt, type Search, type Thread } from '@yaks/inbox'
import { summaryQuery } from '@yaks/inbox/queries'
import { isUnread, type Row } from '../client.ts'
import { inbox as seededInbox, row } from '../live.ts'
import { useQueryResult } from './useQuery.ts'
import { useRows } from './subscriptions.ts'

export let useInboxThreads = (
  actor: string,
  search: Search = {},
  thread?: string,
): { threads: Thread<Row>[]; ready: boolean } => {
  let read = useQueryResult(summaryQuery(actor, search, thread), true, true)
  let summaries = read.eids.flatMap((eid) => {
    let value = row(eid).value?.inbox_summary?.threads
    return Array.isArray(value) ? value as unknown as Thread<Row>[] : []
  })
  useRows([
    ...new Set(summaries.flatMap((t) => [
      t.row.eid,
      t.latest.eid,
      ...(thread ? t.messages.map((m) => m.eid) : []),
    ])),
  ])
  return {
    threads: summaries,
    ready: read.ready && read.subscription?.state.status != 'failed',
  }
}

export let useInboxThread = (actor: string, eid: string) =>
  useInboxThreads(actor, { all: true }, eid)

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
