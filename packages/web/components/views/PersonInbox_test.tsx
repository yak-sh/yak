import { test } from '@yaks/testing'
import '../../testing.ts'
import { assertEquals } from '@std/assert'
import { threads } from '@yaks/inbox'
import { act } from 'preact/test-utils'
import { cache, rows } from '../../live.ts'
import { mount } from '../mount.ts'
import { InboxThreads } from './PersonInbox.tsx'

test('person inbox groups policy threads, shows newest words and answers in place', async () => {
  let ask = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  cache.value = {
    [ask]: {
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
    dependent: { entity: { eid: 'dependent' }, task: {} },
    edge: {
      entity: { eid: 'edge' },
      edge: { from: 'dependent', to: ask },
      requires: {},
    },
    mine: {
      entity: { eid: 'mine' },
      comment: { target: ask },
      doc: { body: 'What do you recommend?' },
      created: { by: 'person', at: '2026-10-02T12:00:00Z' },
    },
    reply: {
      entity: { eid: 'reply' },
      comment: { target: ask, reply_to: 'mine' },
      doc: { body: 'Take the train.' },
      created: { at: '2026-10-02T13:00:00Z' },
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
      ['Needs you 1', 'Replies 0', 'Updates 0', 'Recent 0'],
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
