/** @jsxImportSource preact */
/**
 * A person's inbox: their threads in attention lanes, a search over what was
 * said and received, each thread opened in place to read and answer, and a
 * new conversation started from the top. Membership, lanes and order are the
 * policy's (./threads.ts), read from the server's summary (./asks.ts); every
 * entity is drawn by the host's shared renderers (`Inbox.List.Tile`,
 * `Inbox.Full`), and this view adds only what is its own around them.
 *
 * @module
 */

import { type ComponentChild, Fragment, type JSX } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { Button, Dot, Field, Inbox as Frame, Say, Stamp, Tabs } from '@yaks/ui'
import { type Bundle, identityEid } from '@yaks/graph'
import type { Io } from '@yaks/inspect'
import { Branches, Composer } from '@yaks/kernel/Comments'
import { drafts, useDraft } from '@yaks/draft/input'
import type { Row } from './reader.ts'
import { lanes, type Search, type Thread } from './threads.ts'
import { bundleOf, mark, show, useThread, useThreads } from './asks.ts'
import { usePage } from './front.ts'

/** Where the person's search words wait, across every interface. */
export let searchPlace = (actor: string): string => `${actor}.inbox.search`

/** Where the words of a new conversation wait: one place across browser and
 * terminal; sending spends only this draft. */
export let conversationPlace = (actor: string): string => `${actor}.inbox.new`

/** The call that starts a conversation with these words, exactly. */
export let conversationCall = (text: string): Bundle[] => [{
  entity: { eid: crypto.randomUUID() },
  call: { to: identityEid('tool', ['inbox_new']), args: { text } },
}]

export let NewConversation = ({ actor }: { actor: string }): JSX.Element => {
  let input = useRef<HTMLTextAreaElement>(null)
  let [text, setText] = useState(() => drafts.text(conversationPlace(actor)))
  let { sync, spend } = useDraft(conversationPlace(actor), input, setText)
  let post = () => {
    let words = input.current?.value ?? ''
    if (!words.trim()) return
    // The tool runner writes as the caller. Never trim the words or mint a
    // session here: answering is the host's session policy.
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

// An opened thread: its root drawn whole, its other messages, its comment
// branches, and a composer answering it.
let Conversation = (
  { thread, actor, io }: { thread: Thread<Row>; actor: string; io: Io },
) => {
  let full = useThread(io, actor, thread.eid)
  let t = full.threads[0] ?? thread
  let notes = t.messages.filter((r) => r.comps.comment)
    .map((r) => io.get(r.eid) ?? bundleOf(r))
  let other = t.messages.filter((r) =>
    !r.comps.comment && r.eid != t.eid && r.comps.entry?.session != t.eid
  )
  return (
    <Frame.Detail>
      {show(io, t.eid, 'Inbox.Full', { talkback: false })}
      {other.map((r) => (
        <Fragment key={r.eid}>{show(io, r.eid, 'Full')}</Fragment>
      ))}
      <Branches rows={notes} />
      <Composer eid={t.eid} />
    </Frame.Detail>
  )
}

let ThreadRow = (
  { thread: t, actor, io }: { thread: Thread<Row>; actor: string; io: Io },
) => {
  let view = usePage<{ open: boolean }>(`thread:${t.eid}`)
  let open = !!view.value?.open
  let root = io.get(t.eid) ?? bundleOf(t.row)
  return (
    <Frame.Thread data-thread={t.eid} mod={t.unread && 'unread'}>
      <div>
        {show(io, t.eid, 'Inbox.List.Tile')}
        <Button
          type='button'
          mod='quiet'
          aria-expanded={open}
          onClick={() => {
            if (!open) mark(io, t.eid, 'opened')
            view.set({ open: !open })
          }}
        >
          <Dot
            mod={t.unread ? 'accent' : undefined}
            title={t.unread ? 'unread' : 'read'}
          />
          {open ? 'Collapse thread' : 'Expand thread'}
        </Button>
        <Frame.Reason>
          {t.blocking ? 'blocking · ' : ''}
          {t.reason}
        </Frame.Reason>
        <Stamp>{io.when(t.at)}</Stamp>
        {t.latest.eid != t.eid && show(io, t.latest.eid, 'Inbox.List.Tile')}
      </div>
      <Button
        type='button'
        mod='quiet'
        aria-label={`Archive ${io.id(root)}`}
        onClick={() => mark(io, t.eid, 'archived')}
      >
        archive
      </Button>
      {open && <Conversation thread={t} actor={actor} io={io} />}
    </Frame.Thread>
  )
}

/** The lanes of completed policy records, never reclassified here, with the
 * search's switches above them. */
export let InboxThreads = (
  { threads, ready, search, onSearch, limit, find, actor, io }: {
    threads: Thread<Row>[]
    ready: boolean
    search: Search
    onSearch: (search: Search) => void
    limit?: number
    find?: ComponentChild
    actor: string
    io: Io
  },
): JSX.Element => {
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
            {items.map((t) => (
              <ThreadRow key={t.eid} thread={t} actor={actor} io={io} />
            ))}
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

/** The person's inbox: their own threads, searched, with a new conversation
 * when the host can start one. */
export let PersonInbox = (
  { e, io, limit }: { e: Bundle; io: Io; limit?: number },
): JSX.Element => {
  let actor = e.entity.eid
  let view = usePage<{ direction: 'both' | 'said' | 'received'; all: boolean }>(
    `search:${actor}`,
  )
  let search: Search = {
    direction: view.value?.direction == 'both'
      ? undefined
      : view.value?.direction,
    all: view.value?.all,
  }
  let setSearch = (search: Search) =>
    view.set({ direction: search.direction ?? 'both', all: !!search.all })
  let input = useRef<HTMLInputElement>(null)
  let { text, sync } = useDraft(searchPlace(actor), input)
  let query = { ...search, text }
  let found = useThreads(io, actor, query)
  return (
    <>
      {!!io.vocab.comp('conversation') && !!io.vocab.comp('call') && (
        <NewConversation actor={actor} />
      )}
      <InboxThreads
        {...found}
        actor={actor}
        io={io}
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
