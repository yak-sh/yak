// Hero movement stays live between saves; only players keep a snapshot.
import { equal, test } from '@yaks/testing'
import { FakeTime } from '@std/testing/time'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { subscriptions } from '../../packages/api/subs.ts'
import core from '../../packages/kernel/vocab.json' with { type: 'json' }
import words from './vocab.json' with { type: 'json' }
import { comp } from './bundle.ts'

test('hero saves use position age, settle after disconnect and never save wildlife', async () => {
  using clock = new FakeTime()
  let vocab = loadVocab([words, core])
  let g = graph({ storage: ram(vocab), vocab })
  await g.apply([{ entity: { eid: 'hero' }, player: {} }])
  let subs = subscriptions(g), sink = () => {}
  let at = Date.now()
  let move = (eid: string, x: number) => [{
    entity: { eid },
    position: { level: 'mossvale', x, y: 5, z: 128, at: Date.now() },
  }]
  let stored = () => comp((g.get(['hero']) as Bundle[])[0], 'position')
  await subs.relay(sink, move('hero', 128))
  equal(stored().x, 128)
  await clock.tickAsync(10_000)
  await subs.relay(sink, move('hero', 135))
  await subs.relay(sink, move('wildlife', 130))
  equal(stored().x, 128)
  // Unrelated hero writes must not defer its pending position save.
  await g.apply([{ entity: { eid: 'hero' }, damageable: { on: true } }])
  let connected = '.player .position.level=mossvale'
  equal((await subs.read(connected)).length, 1)
  equal(comp((await subs.read(connected))[0], 'position').x, 135)
  await subs.drop(sink)
  equal((await subs.read(connected)).length, 0)
  await clock.tickAsync(19_999)
  equal(stored().x, 128)
  await clock.tickAsync(1)
  equal([stored().x, stored().at], [135, at + 10_000])
  equal(comp((g.get(['wildlife']) as Bundle[])[0], 'position'), {})
})

test('hibernation restores surviving hero holders and peer wake observers may read and write', async () => {
  using clock = new FakeTime()
  let vocab = loadVocab([words, core])
  let g = graph({ storage: ram(vocab), vocab })
  let at = Date.now()
  let position = { level: 'mossvale', x: 128, y: 5, z: 128, at }
  await g.apply([
    { entity: { eid: 'connected' }, player: {}, position },
    { entity: { eid: 'offline' }, player: {}, position },
  ])
  let before = subscriptions(g), sink = () => {}
  await before.relay(sink, [{ entity: { eid: 'connected' }, position }])
  let keys = before.relaying(sink)
  let after = subscriptions(g), connected = '.player .position.level=mossvale'
  equal(await after.read(connected), [])
  let heard: number[] = []
  let off = after.observe(async () => {
    heard.push((await after.read(connected)).length)
    await g.apply([{ entity: { eid: 'observer' }, player: {} }])
  })
  await after.relayed(sink, keys)
  equal((await after.read(connected)).map((r) => r.entity.eid), ['connected'])
  await clock.tickAsync(0)
  equal(heard[0], 1)
  await after.drop(sink)
  await clock.tickAsync(0)
  equal(heard.includes(0), true)
  equal(await after.read(connected), [])
  off()
})

test('the stored Vale save query compares numeric position age in SQLite', async () => {
  let vocab = loadVocab([words, core]), driver = open(':memory:')
  try {
    let g = graph({ vocab, storage: storage(driver, vocab) })
    g.install()
    let at = Date.parse('2026-10-03T18:00:00.000Z')
    await g.apply([
      { entity: { eid: 'hero' }, player: {}, position: { at } },
      { entity: { eid: 'wildlife' }, position: { at } },
      { entity: { eid: 'new-hero' }, player: {} },
    ])
    let query = words.$defs.position.save
    equal(
      (await g.read(query, { now: at + 29_999 })).map((r) => r.entity.eid),
      ['new-hero'],
    )
    equal(
      (await g.read(query, { now: at + 30_000 })).map((r) => r.entity.eid)
        .sort(),
      ['hero', 'new-hero'],
    )
  } finally {
    driver.close()
  }
})
