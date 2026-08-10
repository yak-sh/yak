import { type Ent } from '../../types.ts'
import { inboxItem, isUnread, readerAt, type Row } from '../../client.ts'
import { ent, mutate, rows } from '../../live.ts'
import { Stamp } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { Id } from './Inline.tsx'
import { Entity } from '../Entity.tsx'
import { ListFrame } from '../ListFrame.tsx'

// The inbox on the canvas: everything addressed to this entity. The
// membership test is client.ts's `inboxItem` — the SAME
// predicate `task inbox` and the context digest read — so a row here and
// a line there cannot disagree about what was addressed to you. Nothing is
// stored: an item is in the inbox because it matches, exactly like a
// board's tasks, so membership can't drift.
//
// Read for the ENTITY you are looking at, which is what makes this a view
// at all: open a venture and you get the venture's mail and knocks; open a
// person and you get theirs. The owner's own is nearly empty on purpose —
// letters to an external address leave the graph for a real mailbox, and
// only what arrives here is ever stamped as arrived.
// Which door it came through — read off the components, never a stored
// kind, because there is no such column.
let doorOf = (r: Row) =>
  r.comps.mail ? 'mail' : r.comps.knock ? 'knock' : 'comment'

let at = (r: Row) => String(r.comps.created?.at ?? '')

// Reading an item must not move it away from its place in the chronology.
let order = (a: Row, b: Row) => at(b).localeCompare(at(a))

// One line. A real anchor, with the Id chip's navigation and entity-menu
// contract applied to the whole row.
let Line = ({ r }: { r: Row }) => {
  let e: Ent = ent(r.eid)
  // A knock is the envelope; its target is what the reader came to see.
  let subject = r.comps.knock ? ent(String(r.comps.knock.target_eid)) : e
  let fresh = isUnread(r)
  return (
    <ListFrame.Row mod={fresh && 'unread'}>
      <Entity
        eid={subject.eid}
        view='List.Tile'
        onOpen={() => {
          // Opening it IS reading it — the same `opened` stamp that
          // `task inbox show` writes, so both doors agree on what you have
          // read. Only `archived` ever hides something.
          if (fresh) mutate({ eid: r.eid, name: 'opened', comp: {} })
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
        /* Archiving is the ONE thing that hides an item: no sweep, subagent
          or other reader can drain your inbox behind you, so this control
          is the only exit and it belongs to the operator. */
      }
      <ListFrame.Action
        type='button'
        title='archive'
        onClick={() => mutate({ eid: r.eid, name: 'archived', comp: {} })}
      >
        ✕
      </ListFrame.Action>
    </ListFrame.Row>
  )
}

export let Inbox = ({ e }: { e: Ent }) => {
  let all = rows()
  let items = all.filter(inboxItem(readerAt(all, e.eid))).sort(order)
  if (!items.length) {
    return (
      <ListFrame.Empty>
        nothing addressed to {e.doc?.title || 'this'} yet
      </ListFrame.Empty>
    )
  }
  let unread = items.filter(isUnread).length
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
      {items.map((r) => <Line key={r.eid} r={r} />)}
    </ListFrame>
  )
}
