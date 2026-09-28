import { assertEquals } from '@std/assert'
import { type Frame, type Sink, subscriptions } from '@yaks/api'
import { graph } from '@yaks/graph'
import { matcher } from '@yaks/match'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { areaOf, placeOf, REACH } from './area.ts'
import words from './vocab.json' with { type: 'json' }

Deno.test('a page sees nearby world rows and moving heroes', () => {
  let at = areaOf(64, 64, REACH)
  let select = matcher(at.query, loadVocab([words]))
  let row = (eid: string, x: number, z: number) => ({
    entity: { eid },
    slain: { creature: 'hare-1', by: 'hero-1' },
    place: placeOf(x, z),
  })
  let hero = (eid: string, x: number, z: number) => ({
    entity: { eid },
    player: {},
    position: { x, z },
  })
  let found = select([
    row('near', 70, 60),
    row('across-border', -4, 64),
    row('far', 500, 500),
    hero('visitor', 66, 65),
    hero('traveller', 500, 500),
  ])
  assertEquals(found.map((b) => b.entity.eid).sort(), [
    'across-border',
    'near',
    'visitor',
  ])
})

Deno.test('a nearby creature reaches another page without a stored row', () => {
  let vocab = loadVocab([words])
  let g = graph({ storage: ram(vocab), vocab })
  let subs = subscriptions(g)
  let heard: Frame[] = []
  let first: Sink = () => {}
  let second: Sink = (frame) => heard.push(frame)
  let query = areaOf(64, 64, REACH).query
  subs.open(first, 'first', query)
  subs.open(second, 'second', query)
  heard.length = 0

  subs.relay(first, [{
    entity: { eid: 'hare-1' },
    position: { level: 'mossvale', x: 70, y: 5, z: 60, at: 1000 },
  }])
  assertEquals(heard.flatMap((f) => f.bundles ?? []).map((b) => b.entity.eid), [
    'hare-1',
  ])
  assertEquals(heard.flatMap((f) => f.relay ?? []).length, 1)
})
