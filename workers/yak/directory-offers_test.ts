// What the gallery, the home page's showcase and every picture they show ask
// of the directory: the offers, read in proportion to the published apps
// rather than to the directory, and one app's offer by its eid (T-143237).
import { equal, ok, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { stepping } from '../../packages/sqlite/testing.ts'
import { platformVocab } from './vocab.ts'
import { directoryRows, type Row } from './directory.ts'

let vocab = platformVocab()
let { driver, steps } = stepping()
let store = storage(driver, vocab)
store.install()
let g = graph({ storage: store, vocab })
let dir = directoryRows({
  query: async (q) =>
    (await g.read(q) as Row[]).map((row) => ({
      ...row,
      policy: { revision: 0 },
    })),
  apply: () => Promise.resolve([]),
})

let space = (eid: string, trashed = false) => ({
  entity: { eid },
  space: { slug: eid, store: eid },
  ...trashed ? { trashed: { at: '2026-11-01' } } : {},
})
let app = (eid: string, space: string, at?: string, trashed = false) => ({
  entity: { eid },
  app: { space, slug: eid, access: 'public', version: 1, store: eid },
  ...at ? { published: { name: eid, version: 1, at } } : {},
  ...trashed ? { trashed: { at: '2026-11-01' } } : {},
})
// Spaces of apps nobody published, which a gallery has no reason to read.
let crowd = async (from: number, n: number) => {
  for (let i = from; i < from + n; i += 100) {
    await g.apply(
      Array.from({ length: 100 }, (_, j) => [
        space(`crowd-${i + j}`),
        app(`crowd-${i + j}-a`, `crowd-${i + j}`),
        app(`crowd-${i + j}-b`, `crowd-${i + j}`),
      ]).flat(),
      { trusted: true },
    )
  }
  driver.query({ t: 'analyze' })
}
await g.apply([
  space('shop'),
  space('bin', true),
  app('new', 'shop', '2026-10-31'),
  app('old', 'shop', '2026-10-29'),
  app('draft', 'shop'),
  app('tossed', 'shop', '2026-10-30', true),
  app('binned', 'bin', '2026-10-30'),
], { trusted: true })
await crowd(0, 100)

let cost = async <T>(read: () => Promise<T>) => {
  let before = steps()
  await read()
  return steps() - before
}

test('the offers are the published apps standing in live spaces, newest first', async () => {
  equal(
    (await dir.offers()).map(({ space, app }) => [space.slug, app.eid]),
    [['shop', 'new'], ['shop', 'old']],
  )
})

test('one offer is asked for by its eid', async () => {
  let at = await dir.offer('old')
  equal([at?.space.slug, at?.app.eid], ['shop', 'old'])
  for (let none of ['draft', 'tossed', 'binned', 'nobody', 'old|.space']) {
    equal(await dir.offer(none), null, none)
  }
})

// Every crowded space adds an entity and two apps, so a read that grew by one
// step for each of them would be reading the crowd.
test('offers read no more for a directory of more unpublished apps', async () => {
  let all = await cost(() => dir.offers())
  let one = await cost(() => dir.offer('new'))
  await crowd(100, 200)
  let more = await cost(() => dir.offers())
  ok(more - all < 200, `${all} VM steps, then ${more}`)
  let again = await cost(() => dir.offer('new'))
  ok(again - one < 200, `${one} VM steps, then ${again}`)
})
