// A conversation's files stay with their messages as its history is windowed.
import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { operatorMemory } from './operator-testing.ts'
import { conversationOf } from './operator-host.ts'

let store = operatorMemory()
let session = crypto.randomUUID()
let request = crypto.randomUUID()
let input = crypto.randomUUID()
let file = { name: 'people.csv', mime: 'text/csv', key: 'checks/people.csv' }
await store.g.apply([
  { entity: { eid: session }, session: { id: session } },
  {
    entity: { eid: request },
    operator_request: {
      space: crypto.randomUUID(),
      person: crypto.randomUUID(),
      channel: 'chat',
      session,
      files: [file],
    },
  },
  {
    entity: { eid: input },
    entry: { session, seq: 1 },
    content: { body: 'Read these people' },
    operator_files: { request, files: [file] },
  },
  ...Array.from({ length: 300 }, (_, i) => ({
    entity: { eid: crypto.randomUUID() },
    entry: { session, seq: i + 2 },
    content: { body: `Reply ${i}` },
    output: { source: input },
  })),
])
let shown = async (from?: number) => {
  let page = await conversationOf(
    store,
    '/chat',
    session,
    undefined,
    undefined,
    undefined,
    undefined,
    from,
  )
  return parseHTML(page.html).document
}
let newest = await shown()
let whole = await shown(0)

let newestRows = newest.querySelectorAll('.Talk_Row').length
let newestLinks = newest.querySelectorAll('.Talk_FilesLink').length
let links = whole.querySelectorAll('.Talk_FilesLink').length
let href = whole.querySelector(`#row-${input} .Talk_FilesLink`)
  ?.getAttribute('href')
let said = whole.querySelector(`#row-${input} .Talk_You`)?.textContent
let footer = whole.querySelector('.Talk_Thread > .Talk_Files')

test('an upload outside the displayed history is not appended below newer messages', () => {
  equal(newestRows, 300)
  equal(newestLinks, 0)
})

test('loading the upload’s message draws its file there once, with its download address', () => {
  equal(links, 1)
  equal(href, `?attachment=${request}&file=0`)
  equal(said, 'Read these people')
  equal(footer, null)
})
