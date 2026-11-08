import { equal, test } from '@yaks/testing'
import { operatorMemory } from './operator-testing.ts'
import { attachmentRows } from './operator-attachments.ts'
import { attachmentQuery } from './attachment-query.ts'

let store = operatorMemory()
let space = crypto.randomUUID(),
  person = crypto.randomUUID(),
  other = crypto.randomUUID()
let held = { space, person, role: 'owner' as const }
let mine = crypto.randomUUID(), theirs = crypto.randomUUID()
let file = (sha: string) => ({
  name: 'private.docx',
  mime: 'application/msword',
  size: 7,
  key: 'checks/.operator/' + sha,
})
let sha = 'a'.repeat(64), hidden = 'b'.repeat(64)
await store.g.apply([
  {
    entity: { eid: mine },
    operator_request: { space, person, channel: 'chat' },
    doc: { body: 'private conversation' },
  },
  {
    entity: { eid: theirs },
    operator_request: { space, person: other, channel: 'chat' },
    doc: { body: 'another person private conversation' },
  },
  ...attachmentRows(mine, [file(sha)]),
  ...attachmentRows(theirs, [file(hidden)]),
], { trusted: true })
let visible = await attachmentQuery(store, held, '.attachment&*')
let artifacts = await attachmentQuery(store, held, '.artifact&*')
let secret = await attachmentQuery(store, held, '.doc&*')
let call = crypto.randomUUID()
let counted = await attachmentQuery(store, held, '.attachment&.count', call)
let focused = await attachmentQuery(store, held, `.entity.eid=${sha}&*`)
let crossed = await attachmentQuery(store, {
  ...held,
  space: crypto.randomUUID(),
}, '.attachment&*')

test('connector attachment reads include own files and their artifact metadata', () => {
  equal(visible.length, 1)
  equal(visible[0].attachment, {
    name: 'private.docx',
    media_type: 'application/msword',
    artifact: sha,
    message: mine,
  })
  equal(artifacts.map((row) => row.entity.eid), [sha])
})

test('connector attachment queries cannot read private messages or another person files', () => {
  equal(secret, [])
  equal(crossed, [])
})

test('attachment queries preserve reductions and the caller identity', () => {
  equal(counted[0].output, { source: call, value: { count: 1 } })
  equal(focused.map((row) => row.entity.eid), [sha])
})
