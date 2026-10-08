/** @jsxImportSource preact */
/**
 * A project's inbox: what is addressed to it, one line per thread in the
 * policy's order, with the whole count above and a `limit` (from the caller's
 * context: a cockpit cell) bounding the lines, never the count. Opening a
 * line reads it, the same `opened` mark every inbox door writes; archiving
 * hides the thread until its next activity.
 *
 * @module
 */

import type { JSX } from 'preact'
import { Button, Dot, Inbox as Frame, Stamp } from '@yaks/ui'
import type { Io, Props } from '@yaks/inspect'
import type { Row } from './reader.ts'
import type { Thread } from './threads.ts'
import { mark, show, useThreads } from './asks.ts'

let Line = ({ t, io }: { t: Thread<Row>; io: Io }) => {
  // A knock is the envelope; its target is what the reader came to see.
  let knock = t.row.comps.knock
  let subject = knock ? String(knock.target) : t.eid
  return (
    <Frame.Thread data-thread={t.eid} mod={t.unread && 'unread'}>
      <div onClick={() => t.unread && mark(io, t.eid, 'opened')}>
        <Dot
          mod={t.unread ? 'accent' : undefined}
          title={t.unread ? 'unread' : 'read'}
        />
        <Frame.Reason>{t.reason}</Frame.Reason>
        {show(io, subject, 'Inbox.List.Tile')}
        <Stamp>{io.when(t.at)}</Stamp>
        {subject != t.eid && show(io, t.eid, 'Id')}
      </div>
      <Button
        type='button'
        mod='quiet'
        title='archive'
        aria-label={`Archive ${
          io.id(io.get(t.eid) ?? { entity: { eid: t.eid } })
        }`}
        onClick={() => mark(io, t.eid, 'archived')}
      >
        ✕
      </Button>
    </Frame.Thread>
  )
}

export let ProjectInbox = ({ e, io, ctx }: Props): JSX.Element => {
  let eid = e.entity.eid
  let limit = typeof ctx.limit == 'number' ? ctx.limit : undefined
  let { threads } = useThreads(io, eid)
  if (!threads.length) {
    return (
      <Frame>
        <Frame.Empty>
          nothing addressed to {show(io, eid, 'Inbox.Recipient.Inline')} yet
        </Frame.Empty>
      </Frame>
    )
  }
  let unread = threads.filter((t) => t.unread).length
  let shown = limit == null ? threads : threads.slice(0, limit)
  return (
    <Frame>
      {
        /* The whole count, never a page: a number that lies about how much
          is waiting is worse than a long list. */
      }
      <Frame.Summary>
        {threads.length} item{threads.length == 1 ? '' : 's'}
        {unread ? ` · ${unread} unread` : ''}
      </Frame.Summary>
      {shown.map((t) => <Line key={t.eid} t={t} io={io} />)}
      {shown.length < threads.length && (
        <Frame.Empty>+{threads.length - shown.length} more</Frame.Empty>
      )}
    </Frame>
  )
}
