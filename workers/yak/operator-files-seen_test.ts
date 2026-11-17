// What a person sees of the attachments in their Operator's store
// (operator-access.ts `theirFiles`): their own, by the request or
// conversation each came with, and never the messages themselves.
import { equal, test } from '@yaks/testing'
import { attachmentRows, attachmentsSeen } from '@yaks/blob/attachment'
import { operatorMemory } from './operator-testing.ts'
import { theirFiles } from './operator-access.ts'

let store = operatorMemory()
let space = crypto.randomUUID(),
  person = crypto.randomUUID(),
  other = crypto.randomUUID()
let held = { space, person, role: 'owner' as const }
let mine = crypto.randomUUID(), theirs = crypto.randomUUID()
let file = (address: string) => ({
  name: 'private.docx',
  media_type: 'application/msword',
  size: 7,
  address,
})
let sha = 'a'.repeat(64), hidden = 'b'.repeat(64)
await store.g.apply([
  // The store is the space's: its sessions name it (operator-root `spaceOf`).
  {
    entity: { eid: crypto.randomUUID() },
    operator_session: { space, person },
  },
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
let seen = async (q: string, by = held, call?: string) =>
  attachmentsSeen(store.g, await theirFiles(store, by), q, call)
let visible = await seen('.attachment&*')
let artifacts = await seen('.artifact&*')
let secret = await seen('.doc&*')
let call = crypto.randomUUID()
let counted = await seen('.attachment&.count', held, call)
let focused = await seen(`.entity.eid=${sha}&*`)
let crossed = await seen('.attachment&*', {
  ...held,
  space: crypto.randomUUID(),
})

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
