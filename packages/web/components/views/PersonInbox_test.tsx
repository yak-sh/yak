import { test } from '@yaks/testing'
import '../../testing.ts'
import { assertEquals } from '@std/assert'
import { threads } from '@yaks/inbox'
import { act } from 'preact/test-utils'
import { cache, ent, rows } from '../../live.ts'
import { mount } from '../mount.ts'
import { drafts } from '../drafts.ts'
import { commentPlace } from '../Comments.tsx'
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
      seen.root.querySelector('.Inbox_Preview')?.textContent,
      'Take the train.',
    )
    assertEquals(
      seen.root.querySelector('.Inbox_Reason')?.textContent,
      'blocking · decision',
    )
    await act(() =>
      (seen.root.querySelector('.Inbox_Open') as HTMLButtonElement).click()
    )
    assertEquals(seen.root.querySelector('[data-decision]') != null, true)
    assertEquals(
      seen.root.querySelector('.Notes_Children')?.textContent?.includes(
        'Take the train.',
      ),
      true,
    )
    assertEquals(seen.root.querySelector('.Comments_New') != null, true)
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
      (seen.root.querySelector('.Inbox_Open') as HTMLButtonElement).click()
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
      seen.root.querySelector('.Inbox_Open')?.getAttribute('aria-expanded'),
      'true',
    )
    assertEquals(
      (seen.root.querySelector('.Comments_New') as HTMLTextAreaElement).value,
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
