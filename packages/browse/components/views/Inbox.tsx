import { attention } from '@yaks/inbox'
import { type Ent } from '../../types.ts'
import { isUnread } from '../../client.ts'
import { ent, mutate } from '../../live.ts'
import { type InboxRow, useInbox } from '../useInbox.ts'
import { Stamp } from '../Stamp.tsx'
import { Dot } from '../Dot.tsx'
import { Id } from './Inline.tsx'
import { Entity } from '../Entity.tsx'
import { ListFrame } from '../ListFrame.tsx'
import { PersonInbox } from './PersonInbox.tsx'

// Embedded thread list; the shared policy supplies membership and ordering.
let doorOf = (r: InboxRow) =>
  r.inbox?.reason ??
    (r.comps.mail ? 'mail' : r.comps.knock ? 'knock' : 'comment')

let at = (r: InboxRow) => r.inbox?.at ?? String(r.comps.created?.at ?? '')

// One line. An anchor, with the Id chip's navigation and entity-menu
// contract applied to the whole row.
let Line = ({ r }: { r: InboxRow }) => {
  let e: Ent = ent(r.eid)
  // A knock is the envelope; its target is what the reader came to see.
  let subject = r.comps.knock ? ent(String(r.comps.knock.target)) : e
  let fresh = r.inbox?.unread ?? isUnread(r)
  return (
    <ListFrame.Row mod={fresh && 'unread'}>
      <Entity
        eid={subject.eid}
        view='List.Tile'
        onOpen={() => {
          // Opening it IS reading it — the same `opened` stamp that
          // `task inbox show` writes, so both doors agree on what you have
          // read. Archive hides the thread until later activity.
          if (fresh) {
            mutate(
              ...attention(r.eid, 'opened').map((b) => ({
                eid: r.eid,
                name: 'opened',
                comp: b.opened ?? null,
              })),
            )
          }
        }}
        slots={{
          before: (
            <>
              <Dot status={fresh ? 'unread' : 'read'} />
              <ListFrame.Label>{doorOf(r)}</ListFrame.Label>
            </>
          ),
          after: (
            <>
              <Stamp at={at(r)} />
              {subject.eid != e.eid && <Id e={e} />}
            </>
          ),
        }}
      />
      {
        /* Archive the thread until its next qualifying activity. */
      }
      <ListFrame.Action
        type='button'
        title='archive'
        onClick={() =>
          mutate(
            ...attention(r.eid, 'archived').map((b) => ({
              eid: r.eid,
              name: 'archived',
              comp: b.archived ?? null,
            })),
          )}
      >
        ✕
      </ListFrame.Action>
    </ListFrame.Row>
  )
}

export let Inbox = (props: { e: Ent; limit?: number }) =>
  props.e.person ? <PersonInbox {...props} /> : <EmbeddedInbox {...props} />

let EmbeddedInbox = ({ e, limit }: { e: Ent; limit?: number }) => {
  // The shared thread policy supplies both ordering and membership.
  let items = useInbox(e.eid)
  if (!items.length) {
    return (
      <ListFrame.Empty>
        nothing addressed to{' '}
        <Entity eid={e.eid} view='Inbox.Recipient.Inline' /> yet
      </ListFrame.Empty>
    )
  }
  let unread = items.filter((r) => r.inbox?.unread ?? isUnread(r)).length
  let shown = limit == null ? items : items.slice(0, limit)
  let more = items.length - shown.length
  return (
    <ListFrame>
      {
        /* The whole count, never a page: a number that lies about how much
          is waiting is worse than a long list. */
      }
      <ListFrame.Summary>
        {items.length} item{items.length == 1 ? '' : 's'}
        {unread ? ` · ${unread} unread` : ''}
      </ListFrame.Summary>
      {shown.map((r) => <Line key={r.eid} r={r} />)}
      {more > 0 && <ListFrame.Row mod='more'>+{more} more</ListFrame.Row>}
    </ListFrame>
  )
}
