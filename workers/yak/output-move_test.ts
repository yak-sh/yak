import { equal, test } from '@yaks/testing'
import { mint } from '@yaks/graph'
import { attachmentRows, attachmentsSeen } from '@yaks/blob/attachment'
import { operatorMemory } from './operator-testing.ts'
import { attachedOf, type File } from './operator-channels.ts'
import { theirFiles } from './operator-access.ts'
import { BATCH, outputBackfill } from './output-move.ts'
import { OUTPUTS } from './operator-store.ts'

// A conversation whose tools made a file at each call before calls attached
// them: one more than a batch, and one the attachment pass attached by its
// result.
let store = operatorMemory()
let space = mint(), person = mint(), session = mint()
let file = (i: number): File => ({
  name: `image-${i}.png`,
  mime: 'image/png',
  key: `${space}/.operator/${i.toString(16).padStart(64, 'a')}`,
  size: i + 1,
})
let made = Array.from({ length: BATCH + 1 }, (_, i) => {
  let call = mint(), result = mint()
  return [
    { entity: { eid: call }, entry: { session }, call: { name: 'image_new' } },
    {
      entity: { eid: result },
      entry: { session },
      result: { call },
      operator_files: { files: [file(i)] },
    },
  ]
})
let early = made[0][1].entity.eid
await store.g.apply([
  {
    entity: { eid: session },
    session: {},
    operator_session: { space, person },
  },
  ...made.flat(),
  ...attachmentRows(early, [attachedOf(file(0))]),
], { trusted: true })

let receipts = new Map<string, string>()
let marked = {
  ...store,
  marks: {
    get: (key: string) => receipts.get(key),
    set: (key: string, value: string) => void receipts.set(key, value),
  },
}
let seen = () =>
  attachmentsSeen(store.g, theirFiles({ space, person }), '.attachment&*')
let batches = 1
while (await outputBackfill(marked)) batches++
let after = await seen()
let again = await outputBackfill(marked)

test('every file a tool made is among the person’s files, once, by its call', () => {
  let names = after.map((b) => (b.attachment as { name: string }).name)
  equal(names.sort(), made.map((_, i) => `image-${i}.png`).sort())
  let by = new Map(
    after.map((b) => [
      (b.attachment as { name: string }).name,
      (b.attachment as { message: string }).message,
    ]),
  )
  equal(by.get('image-0.png'), early)
  equal(by.get('image-1.png'), made[1][0].entity.eid)
  equal(batches, 2)
})

test('a finished pass is a no-op and keeps its receipt', async () => {
  equal(again, false)
  equal(receipts.get(OUTPUTS), 'done')
  equal((await seen()).length, after.length)
})

test('a store kept nowhere owes no pass', async () => {
  equal(await outputBackfill(store), false)
})
