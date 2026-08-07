import { type Ent, idOf } from '../../types.ts'
import { inboxItem, isUnread, readerAt, type Row } from '../../client.ts'
import { ent, mutate, rows } from '../../live.ts'
import { block, el, Stamp } from '../ui.tsx'
import { clickProps, menuAt } from '../nav.tsx'
import { Id } from './Inline.tsx'

// The inbox on the canvas: everything addressed to this entity, unread
// first. The membership test is client.ts's `inboxItem` — the SAME
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
let Frame = block('div', 'Inbox', {
  Item: 'div',
  Dot: 'span',
  Kind: 'span',
  Title: 'a',
  Archive: 'button',
  Empty: 'div',
})
let { Item, Dot, Kind, Title, Archive, Empty } = Frame
let Count = el('div', 'Inbox_Count')

// Which door it came through — read off the components, never a stored
// kind, because there is no such column.
let doorOf = (r: Row) =>
  r.comps.mail ? 'mail' : r.comps.knock ? 'knock' : 'comment'

// One line of it, whatever it is: a letter's subject, a comment's first
// written line, or the entity a knock asks the reader to see. The title
// wins where there is one, because that is the summary its author wrote.
let lineOf = (r: Row, e: Ent) =>
  r.comps.knock
    ? `${idOf(e)} — ${e.doc?.title || e.kind}`
    : String(r.comps.doc?.title ?? '').trim() ||
      String(r.comps.doc?.body ?? '').split('\n').find((l) => l.trim()) ||
      '(no words)'

let at = (r: Row) => String(r.comps.created?.at ?? '')

// Unread first, then newest: the order an inbox is READ in, which is not
// the order things happened in.
let order = (a: Row, b: Row) =>
  Number(isUnread(b)) - Number(isUnread(a)) || at(b).localeCompare(at(a))

// One line. A real anchor, with the Id chip's navigation and entity-menu
// contract applied to the whole row.
let Line = ({ r }: { r: Row }) => {
  let e: Ent = ent(r.eid)
  // A knock is the envelope; its target is what the reader came to see.
  let subject = r.comps.knock ? ent(String(r.comps.knock.target_eid)) : e
  let go = clickProps(subject)
  let fresh = isUnread(r)
  return (
    <Item mod={fresh && 'unread'}>
      <Dot>{fresh ? '●' : '·'}</Dot>
      <Kind>{doorOf(r)}</Kind>
      <Title
        {...go}
        onClick={(ev: MouseEvent) => {
          // Opening it IS reading it — the same `opened` stamp that
          // `task inbox show` writes, so both doors agree on what you have
          // read. Only `archived` ever hides something.
          if (fresh) mutate({ eid: r.eid, name: 'opened', comp: {} })
          go.onClick(ev)
        }}
        onContextMenu={menuAt(subject)}
      >
        {lineOf(r, subject)}
      </Title>
      <Stamp at={at(r)} />
      <Id e={e} />
      {
        /* Archiving is the ONE thing that hides an item: no sweep, subagent
          or other reader can drain your inbox behind you, so this control
          is the only exit and it belongs to the operator. */
      }
      <Archive
        title='archive'
        onClick={() => mutate({ eid: r.eid, name: 'archived', comp: {} })}
      >
        ✕
      </Archive>
    </Item>
  )
}

export let Inbox = ({ e }: { e: Ent }) => {
  let all = rows()
  let items = all.filter(inboxItem(readerAt(all, e.eid))).sort(order)
  if (!items.length) {
    return <Empty>nothing addressed to {e.doc?.title || 'this'} yet</Empty>
  }
  let unread = items.filter(isUnread).length
  return (
    <Frame>
      {
        /* The whole count, never a page: a number that lies about how much
          is waiting is worse than a long list. */
      }
      <Count>
        {items.length} item{items.length == 1 ? '' : 's'}
        {unread ? ` · ${unread} unread` : ''}
      </Count>
      {items.map((r) => <Line key={r.eid} r={r} />)}
    </Frame>
  )
}
