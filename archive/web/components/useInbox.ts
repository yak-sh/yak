// The browser inbox as ordinary subscribed queries. Each delivery arm is a
// narrow query over the graph; the shared pure inbox predicate makes the final
// policy decision, so adding transport does not create a second attention
// policy. The hook owns every actor-keyed subscription for the view lifetime.
import { useLayoutEffect, useState } from 'preact/hooks'
import { useQueryResult } from './useQuery.ts'
import { useEntity } from './subscriptions.ts'
import { inboxItem, isUnread, readerAt, type Row, uniq } from '../client.ts'
import {
  dropAgg,
  holdAgg,
  inbox as seededInbox,
  row,
  subscriptionState,
} from '../live.ts'
import { kindOf } from '../types.ts'
import { inboxCountQueries, inboxQueries } from '../inbox_queries.ts'

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

let useReader = (actor: string) => {
  let profile = useEntity(actor, 'project.color,email.address')
  let subscriptions = useQueryResult(`.subscription.actor=${actor}`)
  return {
    who: readerAt([
      ...(profile?.value ? rows([actor]) : []),
      ...rows(subscriptions.eids),
    ], actor),
    profile,
    subscriptions,
  }
}

let useItems = (
  who: ReturnType<typeof readerAt>,
  unreadOnly: boolean,
  enabled = true,
) => {
  let queries = inboxQueries(who, unreadOnly)
  let reads = [
    useQueryResult(queries[0], enabled),
    useQueryResult(queries[1], enabled),
    useQueryResult(queries[2], enabled),
    useQueryResult(queries[3], enabled),
    useQueryResult(queries[4], enabled),
    useQueryResult(queries[5], enabled),
    useQueryResult(queries[6], enabled),
  ]
  return {
    items: uniq(rows(reads.flatMap((r) => r.eids))).filter(inboxItem(who)),
    ready: reads.every((r) => r.ready),
  }
}

export let useInbox = (actor: string, unreadOnly = false): Row[] => {
  // Tests and host integrations may plant an inbox without a socket.
  let seeded = seededInbox(actor)
  let { who } = useReader(actor)
  let found = useItems(who, unreadOnly)
  let items = seeded.length ? seeded : found.items
  return unreadOnly ? items.filter(isUnread) : items
}

// Render reads do not dial. Identical badges share a counted hold, and the
// last unmount releases it. A loading/refused reply is not a confident zero.
let useCount = (line: string, enabled: boolean): number | undefined => {
  let name = `inbox-count:${line}`
  let [set, setValue] = useState<ReturnType<typeof holdAgg>>()
  useLayoutEffect(() => {
    if (!enabled || !line) return
    setValue(holdAgg(name, line))
    return () => dropAgg(name)
  }, [name, line, enabled])
  let state = enabled && line ? subscriptionState(name) : undefined
  if (!enabled) return undefined
  if (!line) return 0
  return set?.line == line && set.live.value && state?.status == 'ready'
    ? set.map.value[''] ?? 0
    : undefined
}

export let useInboxCount = (actor: string): number | undefined => {
  let seeded = seededInbox(actor)
  let { who, profile, subscriptions } = useReader(actor)
  // EMPTY must be a complete, addressed server answer, not an empty local
  // cache while standing instructions are still in flight. With any watch or
  // mute rows, keep the existing authoritative candidate reads + pure policy.
  let ready = profile?.ready === true &&
    subscriptions.subscription?.state.status == 'ready'
  let counting = ready && subscriptions.eids.length == 0
  let queries = inboxCountQueries(who)
  let counts = [
    useCount(queries[0], counting),
    useCount(queries[1], counting),
    useCount(queries[2], counting),
    useCount(queries[3], counting),
    useCount(queries[4], counting),
  ]
  let found = useItems(who, true, ready && !counting)
  if (seeded.length) return seeded.filter(isUnread).length
  if (!ready) return undefined
  if (!counting) {
    return found.ready ? found.items.filter(isUnread).length : undefined
  }
  return counts.every((n) => n !== undefined)
    ? counts.reduce<number>((n, value) => n + value!, 0)
    : undefined
}
