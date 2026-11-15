// An attachment's rows (./attachment.ts): one artifact for the bytes, one
// attachment per message they came with, and a reader shown only the
// attachments a clause admits.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { eq } from '@yaks/query/core'
import doc from './vocab.json' with { type: 'json' }
import {
  artifactsOf,
  attachmentOf,
  attachmentRows,
  attachmentsSeen,
} from './attachment.ts'

let note = { $defs: { note: { component: true, type: 'object' } } }
let vocab = loadVocab([doc, note])
let g = graph({ vocab, storage: ram(vocab) })
let file = (address: string, name = 'notes.pdf') => ({
  name,
  media_type: 'application/pdf',
  address,
  size: 7,
})
let mine = crypto.randomUUID(), theirs = crypto.randomUUID()
await g.apply([
  { entity: { eid: mine }, note: {} },
  { entity: { eid: theirs }, note: {} },
  ...attachmentRows(mine, [file('a')]),
  ...attachmentRows(theirs, [file('b')]),
], { trusted: true })
let seen = (q: string, call?: string) =>
  attachmentsSeen(g, eq('attachment.message', mine), q, call)

test('the same bytes sent with two messages keep one artifact and both uses', () => {
  let [first, use] = attachmentRows('first', [file('a')])
  let [later, again] = attachmentRows('later', [file('a', 'renamed.pdf')])
  equal(first, later)
  equal(use.entity.eid, attachmentOf('first', 0))
  equal(again.attachment, {
    name: 'renamed.pdf',
    media_type: 'application/pdf',
    artifact: 'a',
    message: 'later',
  })
})

test('a reader sees the attachments admitted and their bytes, never the messages', async () => {
  equal((await seen('.attachment&*')).map((b) => b.entity.eid), [
    attachmentOf(mine, 0),
  ])
  equal((await seen('.artifact&*')).map((b) => b.entity.eid), ['a'])
  equal(await seen('.note&*'), [])
  equal((await seen('.entity.eid=a&*')).map((b) => b.entity.eid), ['a'])
  equal(await seen('.entity.eid=b&*'), [])
  let [counted] = await seen('.attachment&.count', 'q1')
  equal(counted.output, { source: 'q1', value: { count: 1 } })
})

test('an artifact is named by its first bytes, and an address kept nowhere is left out', async () => {
  let png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  let rows = await artifactsOf(
    ['p', 'p', 'gone'],
    (address) => Promise.resolve(address == 'p' ? png : null),
  )
  equal(rows, [{
    entity: { eid: 'p' },
    artifact: { address: 'p', media_type: 'image/png' },
  }])
})
