import { test } from '@yaks/testing'
import '../../testing.ts'
import { assertEquals } from '@std/assert'
import { threads } from '@yaks/inbox'
import { act } from 'preact/test-utils'
import { cache, ent, rows } from '../../live.ts'
import { mount } from '../mount.ts'
import { drafts } from '@yaks/draft/input'
import { commentPlace } from '@yaks/kernel/Comments'
import { parse } from '@yaks/query'
import { extend, registry, resolve } from '../registry.ts'
import { InboxThreads, PersonInbox } from './PersonInbox.tsx'

test('person inbox groups policy threads, shows newest words and answers in place', async () => {
  let ask = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  cache.value = {
    [ask]: {
      entity: { eid: ask, num: 2 },
      task: { eid: ask },
      doc: { eid: ask, title: 'Choose route', body: '' },
      decision: {
        question: 'Which route?',
        choices: [
          { label: 'Train', description: 'Arrive earlier' },
          { label: 'Bus', description: 'Spend less' },
        ],
        recommended: 'Train',
      },
    },
    dependent: {
      entity: { eid: 'dependent', num: 3 },
      task: { eid: 'dependent' },
    },
    edge: {
      entity: { eid: 'edge', num: 4 },
      edge: { from: 'dependent', to: ask },
      requires: {},
    },
    mine: {
      entity: { eid: 'mine', num: 5 },
      comment: { eid: 'mine', target: ask },
      doc: { eid: 'mine', title: '', body: 'What do you recommend?' },
      created: { eid: 'mine', by: 'person', at: '2026-10-02T12:00:00Z' },
    },
    reply: {
      entity: { eid: 'reply', num: 6 },
      comment: { eid: 'reply', target: ask, reply_to: 'mine' },
      doc: { eid: 'reply', title: '', body: 'Take the train.' },
      created: { eid: 'reply', at: '2026-10-02T13:00:00Z' },
    },
  }
  let found = threads(rows(), { actor: 'person', operator: true })
  let seen = mount(
    <InboxThreads threads={found} ready search={{}} onSearch={() => {}} />,
  )
  try {
    assertEquals(
      [...seen.root.querySelectorAll('.Inbox_Heading')].map((n) =>
        n.textContent
      ),
      ['Needs you · 1', 'Replies · 0', 'Updates · 0', 'Recent · 0'],
    )
    assertEquals(seen.root.querySelectorAll('[data-thread]').length, 1)
    assertEquals(
      seen.root.querySelector('.ListTile_Title')?.textContent,
      'Take the train.',
    )
    assertEquals(
      seen.root.querySelector('.Inbox_Reason')?.textContent,
      'blocking · decision',
    )
    await act(() =>
      (seen.root.querySelector('button[aria-expanded]') as HTMLButtonElement)
        .click()
    )
    assertEquals(seen.root.querySelector('[data-decision]') != null, true)
    assertEquals(
      seen.root.querySelector('.Notes_Children')?.textContent?.includes(
        'Take the train.',
      ),
      true,
    )
    assertEquals(seen.root.querySelector('textarea.Field') != null, true)
    let buttons = [...seen.root.querySelectorAll('button')]
    await act(() =>
      (buttons.find((b) => b.textContent == '2. Bus') as HTMLButtonElement)
        .click()
    )
    assertEquals(cache.value[ask].decided?.choice, 'Bus')
  } finally {
    seen.free()
    cache.value = {}
  }
})

test('inbox search controls pass direction and archive choices to the policy reader', async () => {
  let search = {}
  let seen = mount(
    <InboxThreads
      threads={[]}
      ready={false}
      search={search}
      onSearch={(s) => search = s}
    />,
  )
  try {
    assertEquals(seen.root.textContent?.includes('Loading inbox…'), true)
    assertEquals(seen.root.textContent?.includes('No threads here.'), false)
    let click = async (text: string) =>
      await act(() =>
        ([...seen.root.querySelectorAll('button')].find((b) =>
          b.textContent == text
        ) as HTMLButtonElement).click()
      )
    await click('Said')
    assertEquals(search, { direction: 'said' })
    await click('Received')
    assertEquals(search, { direction: 'received' })
    await click('Include archived')
    assertEquals(search, { all: true })
  } finally {
    seen.free()
  }
})

test('an expanded ask shows its full body and resumes its page state and precious draft after remount', async () => {
  let eid = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  let body = 'Please provide the key. '.repeat(20) +
    'Use the scratch account only.'
  cache.value = {
    [eid]: {
      entity: { eid, num: 5 },
      task: { eid },
      doc: { eid, title: 'Provide a key', body },
      filed: { eid, assignee: 'person' },
    },
  }
  let node = () => (
    <InboxThreads
      threads={threads(rows(), { actor: 'person', operator: true })}
      ready
      search={{}}
      onSearch={() => {}}
    />
  )
  let seen = mount(node())
  try {
    await act(() =>
      (seen.root.querySelector('button[aria-expanded]') as HTMLButtonElement)
        .click()
    )
    assertEquals(
      seen.root.querySelector('.Inbox_Detail')?.textContent?.includes(
        'Use the scratch account only.',
      ),
      true,
    )
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
    assertEquals(
      seen.root.querySelector('.Inbox_Detail')?.textContent?.includes(
        'Use the scratch account only.',
      ),
      true,
    )
  } finally {
    seen.free()
    cache.value = {}
  }
})

test('inbox direction and archive switches resume from the page graph after remount', async () => {
  let eid = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  cache.value = {
    [eid]: {
      entity: { eid, num: 6 },
      person: { eid },
      doc: { eid, title: 'Owner' },
    },
  }
  let node = () => <PersonInbox e={ent(eid)} />
  let seen = mount(node())
  try {
    let button = (text: string) =>
      [...seen.root.querySelectorAll('button')].find((b) =>
        b.textContent == text
      ) as HTMLButtonElement
    await act(() => button('Received').click())
    await act(() => button('Include archived').click())
    seen.free()
    seen = mount(node())
    assertEquals(button('Received').getAttribute('aria-pressed'), 'true')
    assertEquals(button('Hide archived').getAttribute('aria-pressed'), 'true')
    assertEquals(button('Both').getAttribute('aria-pressed'), 'false')
  } finally {
    seen.free()
    cache.value = {}
  }
})

test('new conversation keeps its exact draft across remount, rejects blank words and calls inbox_new once', async () => {
  let { NewConversation, conversationPlace } = await import('./PersonInbox.tsx')
  let { identityEid } = await import('@yaks/graph')
  let { useRoute } = await import('../../live.ts')
  let sent: import('../../types.ts').Change[] = []
  let restore = useRoute((frame) => {
    if (
      frame && typeof frame == 'object' && 'apply' in frame &&
      Array.isArray(frame.apply)
    ) sent.push(...frame.apply)
  })
  let actor = 'new-conversation-person'
  let words = '  Keep my spacing  \nSecond line\n'
  let node = () => <NewConversation actor={actor} />
  let seen = mount(node())
  try {
    let box = () => seen.root.querySelector('textarea') as HTMLTextAreaElement
    await act(() => {
      box().value = words
      box().dispatchEvent(
        new (box().ownerDocument.defaultView!.Event)('input', {
          bubbles: true,
        }),
      )
    })
    seen.free()
    await act(() => {
      seen = mount(node())
    })
    assertEquals(box().value, words)

    await act(() => {
      seen.root.querySelector('form')!.dispatchEvent(
        new (box().ownerDocument.defaultView!.Event)('submit', {
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    let calls = sent.filter((c) =>
      c.name == 'call' && c.comp?.to == identityEid('tool', ['inbox_new'])
    )

    assertEquals(calls.length, 1)
    assertEquals(calls[0].comp?.args, { text: words })
    assertEquals(drafts.text(conversationPlace(actor)), '')
    await act(() => {
      box().value = ' \n '
      box().dispatchEvent(
        new (box().ownerDocument.defaultView!.Event)('input', {
          bubbles: true,
        }),
      )
      box().dispatchEvent(
        Object.assign(
          new (box().ownerDocument.defaultView!.Event)('keydown', {
            bubbles: true,
          }),
          { key: 'Enter' },
        ),
      )
    })
    assertEquals(
      sent.filter((c) => c.name == 'call').length,
      1,
    )
    assertEquals(drafts.text(conversationPlace(actor)), ' \n ')
  } finally {
    useRoute(restore)
    seen.free()
    cache.value = {}
  }
})

test('answering session links follow answers edges and repaint the session status', async () => {
  let { AnsweringSessions } = await import('./PersonInbox.tsx')
  let { mutate } = await import('../../live.ts')
  cache.value = {
    root: { entity: { eid: 'root', num: 1 }, conversation: {} },
    answer: {
      entity: { eid: 'answer', num: 2 },
      answers: {},
      edge: { from: 'aaaaaaaa-0000-4000-8000-000000000042', to: 'root' },
    },
    unrelated: {
      entity: { eid: 'unrelated', num: 3 },
      answers: {},
      edge: { from: 'other', to: 'elsewhere' },
    },
    'aaaaaaaa-0000-4000-8000-000000000042': {
      entity: { eid: 'aaaaaaaa-0000-4000-8000-000000000042', num: 42 },
      session: {
        eid: 'aaaaaaaa-0000-4000-8000-000000000042',
        id: 'S-42',
        status: 'running',
      },
      doc: {
        eid: 'aaaaaaaa-0000-4000-8000-000000000042',
        title: 'Thread worker',
      },
    },
  }
  let seen = mount(<AnsweringSessions root='root' />)
  try {
    assertEquals(seen.root.querySelectorAll('a').length, 1)
    assertEquals(
      seen.root.querySelector('.Dot')?.getAttribute('title') == 'running',
      true,
    )
    assertEquals(seen.root.querySelector('a')?.getAttribute('href'), '/S-42')
    await act(() =>
      mutate({
        eid: 'aaaaaaaa-0000-4000-8000-000000000042',
        name: 'session',
        comp: { status: 'completed' },
      })
    )
    assertEquals(
      seen.root.querySelector('.Dot')?.getAttribute('title') == 'completed',
      true,
    )
  } finally {
    seen.free()
    cache.value = {}
  }
})

test('inbox roots and newest messages select contextual shared renderers without nested controls or duplicate roots', async () => {
  let eid = 'cccccccc-1111-4111-8111-cccccccccccc'
  let reply = 'cccccccc-2222-4222-8222-cccccccccccc'
  cache.value = {
    [eid]: {
      entity: { eid, num: 21 },
      conversation: {},
      doc: { eid, title: 'Conversation root', body: 'Exact root words' },
      created: { eid, by: 'person' },
    },
    [reply]: {
      entity: { eid: reply, num: 22 },
      comment: { eid: reply, target: eid },
      doc: { eid: reply, title: '', body: 'Newest reply' },
      created: { eid: reply, at: '2026-10-04T01:00:00Z' },
    },
  }
  let prior = registry.renderers
  extend([
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
  ])
  let seen = mount(
    <InboxThreads
      threads={threads(rows(), { actor: 'person', operator: true })}
      ready
      search={{}}
      onSearch={() => {}}
    />,
  )
  try {
    assertEquals(
      seen.root.textContent?.includes('Contextual conversation tile'),
      true,
    )
    assertEquals(seen.root.textContent?.includes('Newest reply'), true)
    assertEquals(seen.root.querySelector('button a, button button'), null)
    await act(() =>
      (seen.root.querySelector('button[aria-expanded]') as HTMLButtonElement)
        .click()
    )
    assertEquals(
      seen.root.querySelector('.Inbox_Detail')?.textContent?.includes(
        'Contextual conversation full',
      ),
      true,
    )
    assertEquals(
      seen.root.querySelectorAll('.Inbox_Detail section').length > 0,
      true,
    )
    assertEquals(seen.root.querySelectorAll('textarea.Field').length, 1)
  } finally {
    seen.free()
    registry.renderers = prior
    cache.value = {}
  }
})

test('shared Full and Tile fallbacks identify a session without a doc and a decision without a doc', () => {
  cache.value = {
    session: {
      entity: { eid: 'session', num: 23 },
      session: { eid: 'session', id: 'session' },
    },
    decision: {
      entity: { eid: 'decision', num: 24 },
      task: { eid: 'decision' },
      decision: { question: 'Which route?' },
    },
  }
  try {
    assertEquals(
      resolve(ent('session'), 'Inbox.List.Tile').Render,
      resolve(ent('session'), 'Tile').Render,
    )
    assertEquals(resolve(ent('session'), 'Inbox.Full').view, 'Full')
    assertEquals(resolve(ent('decision'), 'Inbox.Full').view, 'Full')
  } finally {
    cache.value = {}
  }
})
