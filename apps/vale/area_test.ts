import { assertEquals } from '@std/assert'
import { matcher } from '@yaks/match'
import { loadVocab } from '@yaks/vocab'
import { areaOf, placeOf, REACH } from './area.ts'
import words from './vocab.json' with { type: 'json' }

Deno.test('a page sees nearby world rows and moving heroes', () => {
  let at = areaOf(64, 64, REACH)
  let select = matcher(at.query, loadVocab([words]))
  let row = (eid: string, x: number, z: number) => ({
    entity: { eid },
    creature: { kind: 'hare' },
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
