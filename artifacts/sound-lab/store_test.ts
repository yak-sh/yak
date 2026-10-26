import { equal, ok, test, throws } from '@yaks/testing'
import { song } from './music.js'
import { bundles, identities, persistence, restore, validate } from './store.js'

test('sound lab restores notes, arrangement and mix from its graph rows', () => {
  let value = song(), ids = identities()
  value.patterns[2].steps[6][7] = { note: 43, velocity: .35 }
  value.mix[2].mute = true
  value.chain = [3, 1, 0, 2, 3, 1, 1, 0]
  equal(restore(bundles(value, ids), ids.composition), value)
  value.pattern = 3
  value.mode = 'chain'
  equal(validate(JSON.parse(JSON.stringify(value))), value)
  throws(() => validate({ ...value, bpm: NaN }))
})

test('sound lab keeps newer edits while an earlier save is in flight and forks remixes', async () => {
  let writes: ReturnType<typeof bundles>[] = [],
    finish: (() => void)[] = [],
    saved: string[] = []
  let store = persistence({
    apply: (rows: ReturnType<typeof bundles>) => {
      writes.push(rows)
      return new Promise((resolve) => finish.push(() => resolve({ ok: true })))
    },
    query: () => [],
    status: () => {},
    saved: (id: string) => saved.push(id),
  })
  let value = song()
  store.change(value)
  let first = store.flush()
  value.title = 'Newer idea'
  store.change(value)
  finish.shift()!()
  await first
  equal(saved, [])
  let second = store.flush()
  equal(writes[1][0].doc!.title, 'Newer idea')
  finish.shift()!()
  await second
  await store.fork()
  store.change(value)
  let third = store.flush()
  ok(writes[0][0].entity.eid !== writes[2][0].entity.eid)
  finish.shift()!()
  await third
  equal(store.dirty(), false)
})
