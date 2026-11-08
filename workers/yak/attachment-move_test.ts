import { equal, test } from '@yaks/testing'
import { platform } from './directory-rows-probe.ts'
import { operatorMemory } from './operator-testing.ts'
import { operatorVocab } from './operator-store.ts'
import { ram } from '@yaks/ram'
import { attachmentBackfill, ATTACHMENTS } from './attachment-move.ts'
import { attachmentQuery } from './attachment-query.ts'
import { sourceReference } from './operator-source.ts'

let p = platform('attachment-move')
let person = crypto.randomUUID()
let spaceId = await p.dir.mint(person, 'attachment-check', 'Attachment check', {
  'x-yak-person': person,
  'x-yak-role': 'owner',
})
let space = (await p.dir.at(spaceId))!
let transcriptReads = 0
let store = operatorMemory(ram(operatorVocab, {
  computed: {
    'session.status': () => {
      transcriptReads++
      return 'settled'
    },
  },
}))
let receipts = new Map<string, string>()
let marked = {
  ...store,
  marks: {
    get: (key: string) => receipts.get(key),
    set: (key: string, value: string) => {
      receipts.set(key, value)
    },
    del: (key: string) => {
      receipts.delete(key)
    },
  },
}
let bytes = new TextEncoder().encode('legacy attachment')
let sha = 'a'.repeat(64), orphan = 'b'.repeat(64)
let key = `${space.store}/.operator/${sha}`
await p.env.BLOBS.put(key, bytes)
await p.env.BLOBS.put(`${space.store}/.operator/${orphan}`, 'unreferenced')
let source = Array.from({ length: 51 }, (_, i) => ({
  entity: { eid: crypto.randomUUID() },
  operator_request: {
    space: space.eid,
    person,
    channel: 'chat',
    files: [{ name: `legacy-${i}.docx`, mime: 'application/msword', key }],
  },
}))
let session = crypto.randomUUID()
let textSha = 'c'.repeat(64)
await p.env.BLOBS.put(`${space.store}/.operator/${textSha}`, 'original words')
await store.g.apply([
  ...source,
  {
    entity: { eid: session },
    session: {},
    operator_session: { space: space.eid, person },
  },
  {
    entity: { eid: '00000000-0000-4000-8000-000000000001' },
    entry: { session, seq: 1 },
    content: { body: 'legacy first' + sourceReference(textSha) },
  },
], { trusted: true })
let pages: number[] = []
let original = p.env.BLOBS.list.bind(p.env.BLOBS)
p.env.BLOBS.list = async (opts) => {
  pages.push(opts.limit ?? 0)
  let page = await original({ prefix: opts.prefix })
  let at = Number(opts.cursor ?? 0)
  return {
    objects: page.objects.slice(at, at + 1),
    truncated: at + 1 < page.objects.length,
    cursor: String(at + 1),
  }
}
let before = transcriptReads
let batches = 0
while (await attachmentBackfill(marked, p.env)) batches++
let uses = await attachmentQuery(store, {
  space: space.eid,
  person,
  role: 'owner',
}, '.attachment&*')
let artifacts = await store.g.read('.artifact&*')
let reads = pages.length
let repeated = await attachmentBackfill(marked, p.env)

test('legacy attachments backfill across bounded pages and share their immutable bytes', () => {
  equal(uses.length, 52)
  equal(artifacts.length, 3)
  equal(
    (artifacts.find((row) => row.entity.eid == sha)!.artifact as {
      size: number
    }).size,
    bytes.length,
  )
  equal(
    uses.every((row) =>
      source.some((message) =>
        message.entity.eid == (row.attachment as { message: string }).message
      ) || (row.attachment as { name: string }).name == 'message.txt'
    ),
    true,
  )
  equal(batches >= 3, true)
  equal(pages, [50, 50, 50])
})

test('a completed attachment backfill is a no-op and keeps its durable receipt', () => {
  equal(repeated, false)
  equal(pages.length, reads)
  equal(receipts.get(ATTACHMENTS), 'done')
})

test('attachment backfill reads file metadata without reading session transcripts', () => {
  equal(transcriptReads - before, 0)
})
