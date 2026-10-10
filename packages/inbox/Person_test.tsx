/** @jsxImportSource preact */
// A person's inbox: lanes of policy threads, a search, each thread opened in
// place, a new conversation, and page state and words that outlive a remount.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { act } from 'preact/test-utils'
import { type Bundle, identityEid } from '@yaks/graph'
import { parse } from '@yaks/query'
import { commentPlace } from '@yaks/kernel/Comments'
import { drafts } from '@yaks/draft/input'
import type { Search } from './threads.ts'
import { threads } from './threads.ts'
import type { Row } from './reader.ts'
import { summaryQuery } from './queries.ts'
import { conversationPlace, InboxThreads, NewConversation } from './Person.tsx'
import {
  button,
  host,
  mount,
  press,
  shop,
  spent,
  texts,
  wait,
} from './testing.tsx'

let rowOf = (b: Bundle): Row => ({
  eid: b.entity.eid,
  comps: b as unknown as Row['comps'],
})
// The person's threads over `rows`, as the policy reads them, drawn by a host
// holding those rows.
let drawn = (rows: Bundle[], more: Parameters<typeof host>[0] = {}) => {
  let h = host(more)
  h.hold(rows)
  let found = threads(rows.map(rowOf), { actor: 'person', operator: true })
  let node = (search: Search = {}, onSearch = (_: Search) => {}) => (
    <InboxThreads
      threads={found}
      ready
      search={search}
      onSearch={onSearch}
      actor='person'
      io={h.io}
    />
  )
  return { h, node }
}
let expand = (root: Element) =>
  press(root.querySelector('button[aria-expanded]'))

test('a person’s inbox lanes policy threads, shows the newest words and answers in place', async () => {
  let ask = crypto.randomUUID()
  let { h, node } = drawn([
    {
      entity: { eid: ask, num: 2 },
      task: {},
      doc: { title: 'Choose route', body: '' },
      decision: {
        question: 'Which route?',
        choices: [
          { label: 'Train', description: 'Arrive earlier' },
          { label: 'Bus', description: 'Spend less' },
        ],
        recommended: 'Train',
      },
    },
    { entity: { eid: 'dependent', num: 3 }, task: {} },
    {
      entity: { eid: 'edge', num: 4 },
      edge: { from: 'dependent', to: ask },
      requires: {},
    },
    {
      entity: { eid: 'mine', num: 5 },
      comment: { target: ask },
      doc: { title: '', body: 'What do you recommend?' },
      created: { by: 'person', at: '2026-10-02T12:00:00Z' },
    },
    {
      entity: { eid: 'reply', num: 6 },
      comment: { target: ask, reply_to: 'mine' },
      doc: { title: '', body: 'Take the train.' },
      created: { at: '2026-10-02T13:00:00Z' },
    },
  ])
  let seen = mount(node())
  try {
    assertEquals(texts(seen.root, '.Inbox_Heading'), [
      'Needs you · 1',
      'Replies · 0',
      'Updates · 0',
      'Recent · 0',
    ])
    assertEquals(seen.root.querySelectorAll('[data-thread]').length, 1)
    assertEquals(texts(seen.root, '.Tile_Title'), [
      'Choose route',
      'Take the train.',
    ])
    assertEquals(texts(seen.root, '.Inbox_Reason'), ['blocking · decision'])
    await expand(seen.root)
    assertEquals(seen.root.querySelector('[data-decision]') != null, true)
    assertEquals(
      seen.root.querySelector('.Notes_Children')?.textContent?.includes(
        'Take the train.',
      ),
      true,
    )
    assertEquals(seen.root.querySelector('textarea.Field') != null, true)
    await press(button(seen.root, '2. Bus'))
    assertEquals(
      (h.io.get(ask)?.decided as { choice?: string } | undefined)?.choice,
      'Bus',
    )
  } finally {
    seen.free()
  }
})

test('the search switches say their choice and the lanes show while loading', async () => {
  let h = host({ answering: false })
  let search: Search = {}
  let seen = mount(
    <InboxThreads
      threads={[]}
      ready={false}
      search={search}
      onSearch={(s) => search = s}
      actor='person'
      io={h.io}
    />,
  )
  try {
    assertEquals(seen.root.textContent?.includes('Loading inbox…'), true)
    assertEquals(seen.root.textContent?.includes('Needs you'), true)
    assertEquals(seen.root.textContent?.includes('No threads here.'), false)
    await press(button(seen.root, 'Said'))
    assertEquals(search, { direction: 'said' })
    await press(button(seen.root, 'Received'))
    assertEquals(search, { direction: 'received' })
    await press(button(seen.root, 'Include archived'))
    assertEquals(search, { all: true })
  } finally {
    seen.free()
  }
})

test('an opened ask shows its whole body, and stays open with its unsent words after a remount', async () => {
  let eid = crypto.randomUUID()
  let body = 'Please provide the key. '.repeat(20) +
    'Use the scratch account only.'
  let { node } = drawn([{
    entity: { eid, num: 5 },
    task: {},
    doc: { title: 'Provide a key', body },
    filed: { assignee: 'person' },
  }])
  let detail = (root: Element) =>
    root.querySelector('.Inbox_Detail')?.textContent?.includes(
      'Use the scratch account only.',
    )
  let seen = mount(node())
  try {
    await expand(seen.root)
    assertEquals(detail(seen.root), true)
    drafts.type(commentPlace(eid), 'Precious unsent words')
    seen.free()
    seen = mount(node())
    assertEquals(
      seen.root.querySelector('button[aria-expanded]')?.getAttribute(
        'aria-expanded',
      ),
      'true',
    )
    assertEquals(
      (seen.root.querySelector('textarea.Field') as HTMLTextAreaElement).value,
      'Precious unsent words',
    )
    assertEquals(detail(seen.root), true)
  } finally {
    seen.free()
  }
})

test('the direction and archive switches come back after a remount', async () => {
  let h = host({ answering: false })
  let owner = { entity: { eid: crypto.randomUUID() } }
  let node = () => <h.Door e={{ ...owner, person: {} }} view='Inbox' />
  let seen = mount(node())
  try {
    await press(button(seen.root, 'Received'))
    await press(button(seen.root, 'Include archived'))
    seen.free()
    seen = mount(node())
    let pressed = (text: string) =>
      button(seen.root, text)?.getAttribute('aria-pressed')
    assertEquals(pressed('Received'), 'true')
    assertEquals(pressed('Hide archived'), 'true')
    assertEquals(pressed('Both'), 'false')
  } finally {
    seen.free()
  }
})

test('a new conversation keeps its exact words across a remount, refuses blank ones and calls inbox_new once', async () => {
  let actor = crypto.randomUUID()
  let words = '  Keep my spacing  \nSecond line\n'
  let seen = mount(<NewConversation actor={actor} />)
  let box = () => seen.root.querySelector('textarea') as HTMLTextAreaElement
  let send = (type: string, more = {}) =>
    box().dispatchEvent(
      Object.assign(
        new (box().ownerDocument.defaultView!.Event)(type, {
          bubbles: true,
          cancelable: true,
        }),
        more,
      ),
    )
  let calls = () =>
    spent.filter((b) =>
      (b.call as { to?: string } | undefined)?.to ==
        identityEid('tool', ['inbox_new'])
    )
  let before = calls().length
  try {
    await act(() => {
      box().value = words
      send('input')
    })
    seen.free()
    seen = mount(<NewConversation actor={actor} />)
    assertEquals(box().value, words)
    await act(() => {
      seen.root.querySelector('form')!.dispatchEvent(
        new (box().ownerDocument.defaultView!.Event)('submit', {
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    assertEquals(calls().length, before + 1)
    assertEquals(calls().at(-1)?.call, {
      to: identityEid('tool', ['inbox_new']),
      args: { text: words },
    })
    assertEquals(drafts.text(conversationPlace(actor)), '')
    await act(() => {
      box().value = ' \n '
      send('input')
      send('keydown', { key: 'Enter' })
    })
    assertEquals(calls().length, before + 1)
    assertEquals(drafts.text(conversationPlace(actor)), ' \n ')
  } finally {
    seen.free()
  }
})

test('roots and newest messages are drawn by the contextual shared renderers, without nesting controls', async () => {
  let eid = crypto.randomUUID()
  let reply = crypto.randomUUID()
  let { node } = drawn([
    {
      entity: { eid, num: 21 },
      conversation: {},
      doc: { title: 'Conversation root', body: 'Exact root words' },
      created: { by: 'person' },
    },
    {
      entity: { eid: reply, num: 22 },
      comment: { target: eid },
      doc: { title: '', body: 'Newest reply' },
      created: { at: '2026-10-04T01:00:00Z' },
    },
  ], {
    views: [
      {
        view: 'Inbox.List.Tile',
        match: parse('.conversation'),
        Render: () => <a href='/root'>Contextual conversation tile</a>,
      },
      {
        view: 'Inbox.Full',
        match: parse('.conversation'),
        Render: () => <section>Contextual conversation full</section>,
      },
    ],
  })
  let seen = mount(node())
  try {
    assertEquals(
      seen.root.textContent?.includes('Contextual conversation tile'),
      true,
    )
    assertEquals(seen.root.textContent?.includes('Newest reply'), true)
    assertEquals(seen.root.querySelector('button a, button button'), null)
    await expand(seen.root)
    let detail = seen.root.querySelector('.Inbox_Detail')!
    assertEquals(
      detail.textContent?.includes('Contextual conversation full'),
      true,
    )
    assertEquals(detail.querySelectorAll('section').length > 0, true)
    assertEquals(seen.root.querySelectorAll('textarea.Field').length, 1)
  } finally {
    seen.free()
  }
})

test('a session and a decision without a doc fall back to the shared Tile and Full', () => {
  let h = host()
  let session = { entity: { eid: 'session', num: 23 }, session: { id: 's' } }
  let decision = {
    entity: { eid: 'decision', num: 24 },
    task: {},
    decision: { question: 'Which route?', choices: [] },
  }
  h.hold([session, decision])
  let seen = mount(
    <div>
      {h.io.show(session, 'Inbox.List.Tile')}
      {h.io.show(decision, 'Inbox.Full')}
    </div>,
  )
  try {
    assertEquals(texts(seen.root, '.Tile .Id'), ['#23'])
    assertEquals(seen.root.querySelector('[data-decision]') != null, true)
  } finally {
    seen.free()
  }
})

test('a person’s inbox draws summary rows and reads a thread’s history only when opened', async () => {
  let actor = crypto.randomUUID(), root = crypto.randomUUID()
  let first = crypto.randomUUID(), latest = crypto.randomUUID()
  let oldWords = 'Historical message available only in expanded detail. '
    .repeat(20)
  let g = await shop([
    { entity: { eid: actor }, person: {}, doc: { title: 'Owner' } },
    {
      entity: { eid: root },
      conversation: {},
      doc: { title: 'Choose a route', body: 'Initial question' },
      created: { by: actor, at: '2026-10-02T12:00:00Z' },
    },
    {
      entity: { eid: first },
      comment: { target: root },
      doc: { body: oldWords },
      created: { by: actor, at: '2026-10-02T12:01:00Z' },
    },
    {
      entity: { eid: latest },
      comment: { target: root, reply_to: first },
      doc: { body: 'Take the train.' },
      created: { at: '2026-10-02T12:02:00Z' },
    },
  ])
  let h = host({ read: (l) => g.read(l) })
  let seen = mount(
    <h.Door e={{ entity: { eid: actor }, person: {} }} view='Inbox' />,
  )
  let opened = summaryQuery(actor, { all: true }, root)
  let detail = () => seen.root.querySelector('.Inbox_Detail')
  try {
    await wait(
      () => seen.root.textContent?.includes('Take the train.') == true,
      'the newest row drawn',
    )
    assertEquals(seen.root.querySelectorAll('[data-thread]').length, 1)
    assertEquals(seen.root.textContent?.includes('Replies · 1'), true)
    assertEquals(seen.root.textContent?.includes('Loading inbox…'), false)
    assertEquals(seen.root.textContent?.includes(oldWords), false)
    assertEquals(h.io.get(first), undefined)
    assertEquals(
      h.asked.filter((l) => l.startsWith('.inbox_summary.actor=')),
      [summaryQuery(actor)],
    )
    await expand(seen.root)
    await wait(
      () => detail()?.textContent?.includes(oldWords) == true,
      'the history’s words',
    )
    assertEquals(h.asked.filter((l) => l == opened).length, 1)
    // the new conversation's words, and the thread's answer
    assertEquals(seen.root.querySelectorAll('textarea.Field').length, 2)
    await expand(seen.root)
    assertEquals(detail(), null)
    assertEquals(h.dropped.includes(opened), true)
    assertEquals(h.errors, [])
  } finally {
    seen.free()
  }
})
