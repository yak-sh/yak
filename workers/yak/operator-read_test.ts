// A step that reads a file names it in a quiet line under the step, which
// opens to what the file holds: a call naming the file, and a script whose
// calls name it, alike.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import { attachmentRows } from '@yaks/blob/attachment'
import { operatorMemory } from './operator-testing.ts'
import { conversationOf } from './operator-host.ts'

let store = operatorMemory()
let session = crypto.randomUUID()
let message = crypto.randomUUID()
let [photo, notes] = ['a', 'b'].map((c) => c.repeat(64))
let seq = 0
let line = (rest: Omit<Bundle, 'entity'>, eid = crypto.randomUUID()) => ({
  entity: { eid },
  entry: { session, seq: ++seq },
  ...rest,
})
// A call and what came back of it.
let step = (name: string, args: unknown, body: unknown) => {
  let call = crypto.randomUUID()
  return [
    line({ call: { name, id: call, args } }, call),
    line({ result: { call }, content: { body: JSON.stringify(body) } }),
  ]
}
let inner = crypto.randomUUID()
await store.g.apply([
  { entity: { eid: session }, session: { id: session } },
  line({ content: { body: 'My photo and notes.' } }, message),
  ...attachmentRows(message, [
    { name: 'photo.png', media_type: 'image/png', address: photo },
    { name: 'notes.txt', media_type: 'text/plain', address: notes },
  ]),
  ...step('attachment_read', { attachment: photo }, { base64: '' }),
  { entity: { eid: inner }, call: { args: { attachment: notes } } },
  ...step('code_mode', { script: 'return 1' }, {
    value: 1,
    calls: [{ id: inner, path: ['yaks', 'attachment_read'] }],
  }),
  ...step('graph_query', { q: '.doc' }, []),
])

let { html } = await conversationOf(
  store,
  '/manage/clerk/operator',
  session,
  undefined,
  () => Promise.resolve(null),
)
let { document } = parseHTML(`<main>${html}</main>`)
let read = [...document.querySelectorAll('.More')].filter((d) =>
  d.querySelector(':scope > summary')!.textContent!.startsWith('Read ')
)

test('each file a step read is named in a quiet line, closed, under that step', () => {
  assertEquals(
    read.map((d) => d.querySelector(':scope > summary')!.textContent),
    ['Read photo.png', 'Read notes.txt'],
  )
  for (let d of read) {
    assertEquals(d.classList.contains('More-quiet'), true)
    assertEquals(d.hasAttribute('open'), false)
  }
})

test('the line opens to what the file holds: a picture as itself, words in a frame', () => {
  let [picture, words] = read.map((d) => d.querySelector('.More_Body')!)
  assertEquals(
    picture.querySelector('img')!.getAttribute('src'),
    `?attachment=${message}&file=0`,
  )
  let frame = words.querySelector('iframe')!
  assertEquals(frame.getAttribute('src'), `?attachment=${message}&file=1`)
  assertEquals(frame.getAttribute('loading'), 'lazy')
  assertEquals(frame.getAttribute('sandbox'), '')
})
