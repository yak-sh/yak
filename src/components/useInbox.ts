// The browser inbox as ordinary subscribed queries. Each delivery arm is a
// narrow query over the graph; the shared pure inbox predicate makes the final
// policy decision, so adding transport does not create a second attention
// policy. The hook owns every actor-keyed subscription for the view lifetime.
import { useQueryEids } from './useQuery.ts'
import { inboxItem, readerAt, type Row, uniq } from '../client.ts'
import { inbox as seededInbox, row } from '../live.ts'
import { kindOf } from '../types.ts'

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

let line = (
  prop: string,
  values: (string | undefined)[],
  extra = '',
) => {
  let got = [...new Set(values.filter((v): v is string => !!v))]
  return got.length ? `.${prop}=${got.join(',')}&.archived=${extra}` : ''
}

export let useInbox = (actor: string): Row[] => {
  // Tests and host integrations may plant an inbox without a socket.
  let seeded = seededInbox(actor)
  let subs = rows(useQueryEids(`.subscription.actor=${actor}`))
  let who = readerAt([...rows([actor]), ...subs], actor)
  let watched = [...(who.watching ?? [])]
  let targets = [actor, ...watched]
  let comments = useQueryEids(line('comment.target', targets))
  let notices = useQueryEids(line('notice.target', targets))
  let knocks = useQueryEids(line('deliver.to', [actor]))
  let watchedKnocks = useQueryEids(line('knock.target', watched))
  // Screens belong in each subscription, before subserve's bounded window:
  // an archive or outbound letter must not spend one of the inbox's slots.
  let mailTargets = useQueryEids(
    line('mail.target', targets, '&.mail.message_id!'),
  )
  let mailAddresses = useQueryEids(
    line('mail.to_addr', [...(who.addrs ?? [])], '&.mail.message_id!'),
  )
  let found = rows([
    ...comments,
    ...notices,
    ...knocks,
    ...watchedKnocks,
    ...mailTargets,
    ...mailAddresses,
  ])
  return seeded.length ? seeded : uniq(found).filter(inboxItem(who))
}
