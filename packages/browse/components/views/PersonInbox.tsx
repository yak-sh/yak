// The person sees threads; membership, lanes and ordering belong to @yaks/inbox.
import { type ComponentChild } from 'preact'
import { attention, lanes, type Search, type Thread } from '@yaks/inbox'
import { useRef, useState } from 'preact/hooks'
import { Button, Field, Inbox as Frame, Say, Tabs } from '@yaks/ui'
import { type Bundle, identityEid } from '@yaks/graph'
import { useLayoutEffect } from 'preact/hooks'
import { type Row } from '../../client.ts'
import { apply, ent, rowsSub, uuid } from '../../live.ts'
import { type Ent, idOf, vocab } from '../../types.ts'
import { Branches, Composer } from '../Comments.tsx'
import { Dot } from '../Dot.tsx'
import { Entity } from '../Entity.tsx'
import { drafts, useDraft } from '../drafts.ts'
import { Stamp } from '../Stamp.tsx'
import { usePage } from '../page.ts'
import { useInboxThreads } from '../useInbox.ts'
import { useQuery } from '../useQuery.ts'

export let inboxSearchPlace = (actor: string) => `${actor}.inbox.search`
export let markThread = (eid: string, mark: 'opened' | 'archived') =>
  void apply(attention(eid, mark)).catch(() => {})

// One place across browser and terminal; sending spends only this draft.
export let conversationPlace = (actor: string) => `${actor}.inbox.new`
export let conversationCall = (text: string): Bundle[] => [{
  entity: { eid: uuid() },
  call: { to: identityEid('tool', ['inbox_new']), args: { text } },
}]

export let NewConversation = ({ actor }: { actor: string }) => {
  let input = useRef<HTMLTextAreaElement>(null)
  let [text, setText] = useState(() => drafts.text(conversationPlace(actor)))
  let { sync, spend } = useDraft(conversationPlace(actor), input, setText)
  let post = () => {
    let words = input.current?.value ?? ''
    if (!words.trim()) return
    // The tool runner writes as the caller. Never trim the actual words or
    // mint a session here: routing is the separately enabled harness effect.
    spend(conversationCall(words))
    input.current!.value = ''
    setText('')
  }
  return (
    <Say
      aria-label='New conversation'
      onSubmit={(event: Event) => {
        event.preventDefault()
        post()
      }}
    >
      <Field
        lines
        elRef={input}
        rows={1}
        aria-label='New conversation'
        placeholder='New conversation…'
        onInput={(event: Event) =>
          sync(event.currentTarget as HTMLTextAreaElement)}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key != 'Enter' || event.shiftKey) return
          event.preventDefault()
          post()
        }}
      />
      <Button type='submit' disabled={!text.trim()}>
        Start conversation
      </Button>
    </Say>
  )
}

// Answer links hold the sessions themselves: their status is computed on the
// session read, not copied onto a thread or inferred from its last reply.
export let AnsweringSessions = ({ root }: { root: string }) => {
  let links = useQuery(
    vocab.comp('answers') ? `.answers&.edge.to=${root}&?edge` : '',
  )
  let ids = [
    ...new Set(links.map((e) => String((e.edge as { from: string }).from))),
  ]
  let key = ids.join(',')
  useLayoutEffect(() => rowsSub(key ? key.split(',') : []), [key])
  return ids.length
    ? (
      <section aria-label='Answering sessions'>
        {ids.map((eid) => (
          <Entity
            key={eid}
            eid={eid}
            view='Inbox.List.Tile'
          />
        ))}
      </section>
    )
    : null
}

let Conversation = ({ thread: t }: { thread: Thread<Row> }) => {
  let notes = t.messages.filter((r) => r.comps.comment).map((r) => ent(r.eid))
  let other = t.messages.filter((r) =>
    !r.comps.comment && r.eid != t.eid && r.comps.entry?.session != t.eid
  )
  return (
    <Frame.Detail>
      <Entity eid={t.eid} view='Inbox.Full' talkback={false} />
      <AnsweringSessions root={t.eid} />
      {other.map((r) => <Entity key={r.eid} eid={r.eid} view='Full' />)}
      <Branches rows={notes} />
      <Composer eid={t.eid} />
    </Frame.Detail>
  )
}

let ThreadRow = ({ thread: t }: { thread: Thread<Row> }) => {
  let view = usePage<{ open: boolean }>('inboxView', `thread:${t.eid}`)
  let open = !!view.value?.open
  let e = ent(t.eid)
  return (
    <Frame.Thread data-thread={t.eid} mod={t.unread && 'unread'}>
      <div>
        <Entity eid={t.eid} view='Inbox.List.Tile' />
        <Button
          type='button'
          mod='quiet'
          aria-expanded={open}
          onClick={() => {
            if (!open) markThread(t.eid, 'opened')
            view.set({ open: !open })
          }}
        >
          <Dot status={t.unread ? 'unread' : 'read'} />
          {open ? 'Collapse thread' : 'Expand thread'}
        </Button>
        <Frame.Reason>
          {t.blocking ? 'blocking · ' : ''}
          {t.reason}
        </Frame.Reason>
        <Stamp at={t.at} />
        {t.latest.eid != t.eid && (
          <Entity eid={t.latest.eid} view='Inbox.List.Tile' />
        )}
      </div>
      <Button
        type='button'
        mod='quiet'
        aria-label={`Archive ${idOf(e)}`}
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
  { threads, ready, search, onSearch, limit, find }: {
    threads: Thread<Row>[]
    ready: boolean
    search: Search
    onSearch: (search: Search) => void
    limit?: number
    find?: ComponentChild
  },
) => {
  let shown = limit == null ? threads : threads.slice(0, limit)
  return (
    <Frame>
      <Frame.Tools>
        {find}
        <Tabs aria-label='Search direction'>
          {([undefined, 'said', 'received'] as const).map((direction) => (
            <Frame.Mode
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
            </Frame.Mode>
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
              {lane} · {items.length}
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
  let view = usePage<{ direction: 'both' | 'said' | 'received'; all: boolean }>(
    'inboxView',
    `search:${e.eid}`,
  )
  let search: Search = {
    direction: view.value?.direction == 'both'
      ? undefined
      : view.value?.direction,
    all: view.value?.all,
  }
  let setSearch = (search: Search) =>
    view.set({
      direction: search.direction ?? 'both',
      all: !!search.all,
    })
  let input = useRef<HTMLInputElement>(null)
  let { text, sync } = useDraft(inboxSearchPlace(e.eid), input)
  let query = { ...search, text }
  let found = useInboxThreads(e.eid, query)
  return (
    <>
      {vocab.comp('conversation') && vocab.comp('call') && (
        <NewConversation actor={e.eid} />
      )}
      <InboxThreads
        {...found}
        search={query}
        onSearch={setSearch}
        limit={limit}
        find={
          <Field
            elRef={input}
            type='search'
            aria-label='Search inbox'
            placeholder='Search your threads…'
            onInput={(event: Event) =>
              sync(event.currentTarget as HTMLInputElement)}
          />
        }
      />
    </>
  )
}
