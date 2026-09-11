// The browser inbox as ordinary subscribed queries. Each delivery arm is a
// narrow query over the graph; the shared pure inbox predicate makes the final
// policy decision, so adding transport does not create a second attention
// policy. The hook owns every actor-keyed subscription for the view lifetime.
import { useQueryEids } from './useQuery.ts'
import { inboxItem, isUnread, readerAt, type Row, uniq } from '../client.ts'
import { inbox as seededInbox, row } from '../live.ts'
import { kindOf } from '../types.ts'
import { inboxQueries } from '../inbox_queries.ts'

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

export let useInbox = (actor: string, unreadOnly = false): Row[] => {
  // Tests and host integrations may plant an inbox without a socket.
  let seeded = seededInbox(actor)
  let subs = rows(useQueryEids(`.subscription.actor=${actor}`))
  let who = readerAt([...rows([actor]), ...subs], actor)
  let queries = inboxQueries(who, unreadOnly)
  let comments = useQueryEids(queries[0])
  let notices = useQueryEids(queries[1])
  let knocks = useQueryEids(queries[2])
  let watchedKnocks = useQueryEids(queries[3])
  let mailTargets = useQueryEids(queries[4])
  let mailAddresses = useQueryEids(queries[5])
  let found = rows([
    ...comments,
    ...notices,
    ...knocks,
    ...watchedKnocks,
    ...mailTargets,
    ...mailAddresses,
  ])
  let items = seeded.length ? seeded : uniq(found).filter(inboxItem(who))
  return unreadOnly ? items.filter(isUnread) : items
}
