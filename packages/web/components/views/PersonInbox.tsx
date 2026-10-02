// The person sees threads; membership, lanes and ordering belong to @yaks/inbox.
import { attention, lanes, type Search, type Thread } from '@yaks/inbox'
import { useRef, useState } from 'preact/hooks'
import { block, Button, Tabs } from '@yaks/ui'
import { type Row } from '../../client.ts'
import { apply, ent } from '../../live.ts'
import { type Ent } from '../../types.ts'
import { Branches, Composer } from '../Comments.tsx'
import { Decision } from '../Decision.tsx'
import { Entity } from '../Entity.tsx'
import { useDraft } from '../drafts.ts'
import { linkProps } from '../nav.tsx'
import { Stamp } from '../Stamp.tsx'
import { useInboxThreads } from '../useInbox.ts'

let Frame = block('section', 'Inbox', {
  Tools: 'div',
  Search: 'input',
  Lane: 'section',
  Heading: 'h2',
  Thread: 'article',
  Open: 'button',
  Title: 'span',
  Reason: 'span',
  Preview: 'span',
  Detail: 'div',
  Empty: 'p',
})

export let inboxSearchPlace = (actor: string) => `${actor}.inbox.search`
export let markThread = (eid: string, mark: 'opened' | 'archived') =>
  void apply(attention(eid, mark)).catch(() => {})

let preview = (r: Row) =>
  String(
    r.comps.content?.body ?? r.comps.doc?.body ?? r.comps.commit?.message ??
      r.comps.decision?.question ?? r.comps.doc?.title ?? '',
  ).replace(/\s+/g, ' ').trim().slice(0, 240)

let Conversation = ({ thread: t }: { thread: Thread<Row> }) => {
  let e = ent(t.eid)
  let notes = t.messages.filter((r) => r.comps.comment).map((r) => ent(r.eid))
  let other = t.messages.filter((r) => !r.comps.comment)
  return (
    <Frame.Detail>
      <a {...linkProps(e)}>open {e.doc?.title || 'thread'}</a>
      {e.decision && <Decision e={e} />}
      {other.map((r) => <Entity key={r.eid} eid={r.eid} view='Full' />)}
      <Branches rows={notes} />
      <Composer eid={t.eid} />
    </Frame.Detail>
  )
}

let ThreadRow = ({ thread: t }: { thread: Thread<Row> }) => {
  let [open, setOpen] = useState(false)
  let e = ent(t.eid)
  return (
    <Frame.Thread data-thread={t.eid} mod={t.unread && 'unread'}>
      <Frame.Open
        type='button'
        aria-expanded={open}
        onClick={() => {
          if (!open) markThread(t.eid, 'opened')
          setOpen(!open)
        }}
      >
        <Frame.Title>{e.doc?.title || 'Thread'}</Frame.Title>
        <Frame.Reason>
          {t.blocking ? 'blocking · ' : ''}
          {t.reason}
        </Frame.Reason>
        <Stamp at={t.at} />
        <Frame.Preview>{preview(t.latest)}</Frame.Preview>
      </Frame.Open>
      <Button
        type='button'
        mod='quiet'
        aria-label={`Archive ${e.doc?.title || 'thread'}`}
        onClick={() => markThread(t.eid, 'archived')}
      >
        archive
      </Button>
      {open && <Conversation thread={t} />}
    </Frame.Thread>
  )
}

/** The shared view accepts completed policy records, never reclassifies them. */
export let InboxThreads = (
  { threads, ready, search, onSearch, limit }: {
    threads: Thread<Row>[]
    ready: boolean
    search: Search
    onSearch: (search: Search) => void
    limit?: number
  },
) => {
  let shown = limit == null ? threads : threads.slice(0, limit)
  return (
    <Frame>
      <Frame.Tools>
        <Tabs aria-label='Search direction'>
          {([undefined, 'said', 'received'] as const).map((direction) => (
            <Tabs.Tab
              type='button'
              key={direction || 'both'}
              mod={direction == search.direction && 'on'}
              aria-pressed={direction == search.direction}
              onClick={() => onSearch({ ...search, direction })}
            >
              {direction == 'said'
                ? 'Said'
                : direction == 'received'
                ? 'Received'
                : 'Both'}
            </Tabs.Tab>
          ))}
        </Tabs>
        <Button
          type='button'
          mod='quiet'
          aria-pressed={!!search.all}
          onClick={() => onSearch({ ...search, all: !search.all })}
        >
          {search.all ? 'Hide archived' : 'Include archived'}
        </Button>
      </Frame.Tools>
      {!ready && <Frame.Empty role='status'>Loading inbox…</Frame.Empty>}
      {lanes.map((lane) => {
        let items = shown.filter((t) => t.lane == lane)
        return (
          <Frame.Lane key={lane} aria-label={lane}>
            <Frame.Heading>
              {lane} <small>{items.length}</small>
            </Frame.Heading>
            {items.map((t) => <ThreadRow key={t.eid} thread={t} />)}
            {ready && !items.length && (
              <Frame.Empty>No threads here.</Frame.Empty>
            )}
          </Frame.Lane>
        )
      })}
      {shown.length < threads.length && (
        <Frame.Empty>+{threads.length - shown.length} more</Frame.Empty>
      )}
    </Frame>
  )
}

export let PersonInbox = ({ e, limit }: { e: Ent; limit?: number }) => {
  let [search, setSearch] = useState<Search>({})
  let input = useRef<HTMLInputElement>(null)
  let { text, sync } = useDraft(inboxSearchPlace(e.eid), input)
  let query = { ...search, text }
  let found = useInboxThreads(e.eid, query)
  return (
    <>
      <Frame.Search
        ref={input}
        type='search'
        aria-label='Search inbox'
        placeholder='Search your threads…'
        onInput={(event: Event) =>
          sync(event.currentTarget as HTMLInputElement)}
      />
      <InboxThreads
        {...found}
        search={query}
        onSearch={setSearch}
        limit={limit}
      />
    </>
  )
}
