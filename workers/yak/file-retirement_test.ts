import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, pick } from '@yaks/vocab'
import { sweepDoc } from '@yaks/platform/sweep-vocab'
import { bucketObjects } from '@yaks/blob'
import { memoryBucket } from '../../packages/blob/testing.ts'
import type { Directory } from './directory.ts'
import {
  purgedPrefix,
  reclaimed,
  referenced,
  retired,
  retiring,
  retiringPrefix,
} from './file-retirement.ts'
import { pruned } from './written.ts'
import { spineDoc } from '@yaks/kernel/vocab'
import { reclaimFiles } from './file-retirement-graph.ts'
import { WINDOW } from './recover.ts'

let vocab = loadVocab([
  spineDoc,
  pick(sweepDoc, ['file_retirement']),
  {
    $defs: Object.fromEntries(['app', 'space', 'visit'].map((name) => [name, {
      component: true,
      properties: { name: { type: 'string' } },
    }])),
  },
])
let ledger = () => graph({ vocab, storage: ram(vocab) })
let now = Date.parse('2026-11-18T00:00:00Z')
let key = 'sha/' + 'a'.repeat(64)
// A directory with no apps: each reader over many answers none.
let nothing = () => Promise.resolve(new Map())
let dir = {
  all: () => Promise.resolve([]),
  deploysOf: nothing,
  switchesOf: nothing,
  draftsOf: nothing,
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

test('a newly orphaned blob stays in trash without scheduling a purge', async () => {
  let waits: number[] = []
  await retired(g, dir, blobs, first.entity.eid, {
    defer: (delay) => {
      waits.push(delay)
      return Promise.resolve()
    },
  }, now + WINDOW - 1)
  equal(waits, [])
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

test('an orphan remains recoverable after its restore window', async () => {
  await retired(g, dir, blobs, first.entity.eid, undefined, now + WINDOW)
  equal(await blobs.has(key), true)
  equal((await g.read('.file_retirement')).length, 1)
})

// Cancellation runs inside the referrer's write, before any effect can run.
let ruleVocab = loadVocab([
  spineDoc,
  pick(sweepDoc, ['file_retirement']),
  {
    $defs: {
      app: { component: true, properties: { name: { type: 'string' } } },
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

let erased = ledger(), erasedBlobs = bucketObjects(memoryBucket().bucket)
let owner = crypto.randomUUID(), photo = 'ada/.apps/old/blobs/photo'
await erased.apply([{ entity: { eid: owner }, app: { name: 'old app' } }], {
  trusted: true,
})
await erasedBlobs.put(photo, bytes)
await retiringPrefix(erased, erasedBlobs, 'ada/.apps/old/', owner)
let [owned] = await erased.read('.file_retirement')
let waits: number[] = []
let defer = {
  defer: (delay: number) => {
    waits.push(delay)
    return Promise.resolve()
  },
}
await retired(erased, dir, erasedBlobs, owned.entity.eid, defer, now)
let whileNamed = await erasedBlobs.has(photo)
await erased.apply([{ entity: { eid: owner }, app: null }], { trusted: true })
await retired(erased, dir, erasedBlobs, owned.entity.eid, defer, now + 1)
await retired(erased, dir, erasedBlobs, owned.entity.eid, defer, now + WINDOW)
let beforeWindow = await erasedBlobs.has(photo)
await retired(
  erased,
  dir,
  erasedBlobs,
  owned.entity.eid,
  defer,
  now + WINDOW + 1,
)
let afterWindow = await erasedBlobs.has(photo)
let eraseWaits = [...waits]

test('retirement preserves prefix bytes indefinitely after the owner disappears', () => {
  equal(whileNamed, true)
  equal(beforeWindow, true)
  equal(afterWindow, true)
  equal(eraseWaits, [])
})

let restored = ledger(), restoredBlobs = bucketObjects(memoryBucket().bucket)
await restoredBlobs.put(photo, bytes)
await retiringPrefix(restored, restoredBlobs, 'ada/.apps/old/', owner)
let [restoreRun] = await restored.read('.file_retirement')
await retired(restored, dir, restoredBlobs, restoreRun.entity.eid, defer, now)
await restored.apply([{
  entity: { eid: owner },
  app: { name: 'restored app' },
}], { trusted: true })
await retired(
  restored,
  dir,
  restoredBlobs,
  restoreRun.entity.eid,
  defer,
  now + WINDOW,
)

test('a restored app keeps its queued prefix bytes', async () => {
  equal(await restoredBlobs.has(photo), true)
})

let reused = ledger(), reusedBlobs = bucketObjects(memoryBucket().bucket)
await reusedBlobs.put(photo, bytes)
await retiringPrefix(reused, reusedBlobs, 'ada/.apps/old/', owner)
let [reuseRun] = await reused.read('.file_retirement')
await retired(reused, dir, reusedBlobs, reuseRun.entity.eid, defer, now)
let reuseDir = {
  all: () => Promise.resolve([{ store: 'ada' }]),
  apps: () =>
    Promise.resolve([{ eid: crypto.randomUUID(), files: 'ada/.apps/old' }]),
} as unknown as Directory
await retired(
  reused,
  reuseDir,
  reusedBlobs,
  reuseRun.entity.eid,
  defer,
  now + WINDOW,
)

test('a new app reusing a legacy prefix keeps its files from the former owner retirement', async () => {
  equal(await reusedBlobs.has(photo), true)
})

let racing = ledger(), raceBlobs = bucketObjects(memoryBucket().bucket)
await raceBlobs.put(photo, bytes)
await retiringPrefix(racing, raceBlobs, 'ada/.apps/old/', owner)
let [raceRun] = await racing.read('.file_retirement')
await retired(racing, dir, raceBlobs, raceRun.entity.eid, defer, now)
let raceDir = {
  all: async () => {
    // A restore and another erase reset the clock while the census yields.
    await racing.apply([{
      entity: raceRun.entity,
      file_retirement: { at: null },
    }], { trusted: true })
    return []
  },
} as unknown as Directory
let raceWaits: number[] = []
await retired(racing, raceDir, raceBlobs, raceRun.entity.eid, {
  defer: (delay) => {
    raceWaits.push(delay)
    return Promise.resolve()
  },
}, now + WINDOW)

test('a queued retirement cannot delete bytes or schedule its own purge', async () => {
  equal(await raceBlobs.has(photo), true)
  equal(raceWaits, [])
  equal((await racing.read('.file_retirement')).length, 1)
})

let clockOwner = crypto.randomUUID()
await atomic.apply(
  [{ entity: { eid: clockOwner }, app: { name: 'restored' } }],
  { trusted: true },
)
await retiring(atomic, [photo], now, clockOwner)
let [clockRun] = await atomic.read('.file_retirement')
await atomic.apply([{
  entity: clockRun.entity,
  file_retirement: { at: new Date(now).toISOString() },
}], { trusted: true })
await atomic.apply([{ entity: { eid: clockOwner }, app: null }], {
  trusted: true,
})
let [resetClock] = await atomic.read('.file_retirement')

test('removing the owner component resets its prefix clock transactionally', () => {
  equal((resetClock.file_retirement as { at?: string | null }).at ?? null, null)
})

test('a person-confirmed prefix purge removes its bytes and retirement pointer', async () => {
  let g = ledger(), blobs = bucketObjects(memoryBucket().bucket)
  await blobs.put(photo, bytes)
  await retiring(g, [photo], now)
  equal(await purgedPrefix(g, blobs, 'ada/.apps/old/'), [photo])
  equal(await blobs.has(photo), false)
  equal(await g.read('.file_retirement'), [])
})

test('the app sweep leaves immutable workbench snapshots outside its namespaces', async () => {
  let blobs = bucketObjects(memoryBucket().bucket)
  let keys = ['workbench/object/one.tar.gz', 'workbench/object/one.json']
  for (let key of keys) await blobs.put(key, bytes)
  let candidates: string[] = []
  await pruned(dir, blobs, [], now + WINDOW * 100, (keys) => {
    candidates.push(...keys)
    return Promise.resolve()
  })
  equal(candidates, [])
  equal(await Promise.all(keys.map((key) => blobs.has(key))), [true, true])
})

// Both apps' immutable release manifests name the same global content object.
test('purging one owner keeps content shared by another live or trashed owner', async () => {
  let g = ledger(), blobs = bucketObjects(memoryBucket().bucket)
  let first = 'ada/.apps/first/', second = 'ada/.apps/second/'
  let shared = 'sha/' + 'a'.repeat(64)
  for (let prefix of [first, second]) {
    await blobs.put(prefix + '.manifest', new TextEncoder().encode(shared))
  }
  await blobs.put(shared, bytes)
  await retiring(g, [shared, first + '.manifest'], now)
  await purgedPrefix(g, blobs, first)
  equal(await blobs.has(first + '.manifest'), false)
  equal(await blobs.has(second + '.manifest'), true)
  equal(await blobs.get(shared), bytes)
  // Even an overbroad prefix cannot turn owner erasure into shared-byte loss.
  equal(await purgedPrefix(g, blobs, 'sha/'), [])
  equal(await blobs.get(shared), bytes)
})
