import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, pick } from '@yaks/vocab'
import { sweepDoc } from '@yaks/platform/sweep-vocab'
import { bucketObjects } from '@yaks/blob'
import { memoryBucket } from '../../packages/blob/testing.ts'
import type { Directory } from './directory.ts'
import { reclaimed, referenced, retired, retiring } from './file-retirement.ts'
import { pruned } from './written.ts'
import { reclaimFiles } from './file-retirement-graph.ts'
import { WINDOW } from './recover.ts'

let vocab = loadVocab([pick(sweepDoc, ['file_retirement'])])
let ledger = () => graph({ vocab, storage: ram(vocab) })
let now = Date.parse('2026-11-18T00:00:00Z')
let key = 'sha/' + 'a'.repeat(64)
let dir = {
  all: () => Promise.resolve([]),
} as unknown as Directory
let bytes = new TextEncoder().encode('kept for recovery')

let g = ledger(), blobs = bucketObjects(memoryBucket().bucket)
await blobs.put(key, bytes)
await retiring(g, [key], now)
await retiring(g, [key], now + 1000)
let [first] = await g.read('.file_retirement')

test('successive sweeps keep the first orphan observation', () => {
  equal(first.file_retirement, { keys: [key], at: new Date(now).toISOString() })
})

test('a recently orphaned old blob waits thirty days through effect defer', async () => {
  let waits: number[] = []
  await retired(g, dir, blobs, first.entity.eid, {
    defer: (delay) => {
      waits.push(delay)
      return Promise.resolve()
    },
  }, now + WINDOW - 1)
  equal(waits, [1])
  equal(await blobs.has(key), true)
})

test('a default sweep never deletes orphaned bytes', async () => {
  await pruned(dir, blobs, [], now + WINDOW * 2, () => Promise.resolve())
  equal(await blobs.has(key), true)
})

let again = ledger()
await retiring(again, [key], now)
await reclaimed(again, [key])
await retiring(again, [key], now + WINDOW - 1)
let [second] = await again.read('.file_retirement')

test('a file named again gets a fresh full window when orphaned again', () => {
  equal(second.file_retirement, {
    keys: [key],
    at: new Date(now + WINDOW - 1).toISOString(),
  })
})

test('reference cancellation includes the replaced file and full release manifest', () => {
  equal(
    referenced({
      entity: { eid: crypto.randomUUID() },
      written: { sha: 'a', was: 'b' },
      deploy: { files: JSON.stringify({ 'index.html': 'c' }) },
    }),
    ['sha/a', 'sha/b', 'sha/c'],
  )
})

test('an orphan goes only after its restore window', async () => {
  await retired(g, dir, blobs, first.entity.eid, undefined, now + WINDOW)
  equal(await blobs.has(key), false)
  equal(await g.read('.file_retirement'), [])
})

// Cancellation runs inside the referrer's write, before any effect can run.
let ruleVocab = loadVocab([
  pick(sweepDoc, ['file_retirement']),
  {
    $defs: {
      written: {
        component: true,
        properties: {
          sha: { type: 'string' },
          was: { type: 'string' },
        },
      },
    },
  },
])
let atomic = graph({
  vocab: ruleVocab,
  storage: ram(ruleVocab),
  plugins: [reclaimFiles()],
})
await retiring(atomic, [key], now)
let write = crypto.randomUUID()
await atomic.apply(
  [{ entity: { eid: write }, written: { sha: key.slice(4) } }],
  { trusted: true },
)
let afterReference = await atomic.read('.file_retirement')
await retiring(atomic, [key], now + 1000)
await atomic.apply([{ entity: { eid: write }, $delete: true }], {
  trusted: true,
})
let afterRemoval = await atomic.read('.file_retirement')

test('reference and removal cancel old retirement in their own commits', () => {
  equal(afterReference, [])
  equal(afterRemoval, [])
})
