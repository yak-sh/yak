import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { comp } from './bundle.ts'
import { GIVERS } from './quests.ts'
import { aboutOf, characterOf, eidOf, persona } from './villagers.ts'
import characters from './seed/characters.json' with { type: 'json' }
import words from './vocab.json' with { type: 'json' }

test('each villager has a distinct story on their graph entity', () => {
  let rows = new Map(characters.map((row) => [row.entity.eid, row]))
  assertEquals(rows.size, GIVERS.length)
  for (let g of GIVERS) {
    let character = rows.get(eidOf(g.id))?.character
    assertEquals(typeof character?.story, 'string', g.name)
    assertEquals(character?.traits.length, 3, g.name)
  }
  assertEquals(
    new Set(characters.map((row) => row.character.story)).size,
    GIVERS.length,
  )
})

test('loading character data keeps a villager’s existing fields', async () => {
  let vocab = loadVocab([words])
  let g = graph({ storage: ram(vocab), vocab })
  let wren = GIVERS.find((g) => g.id == 'wren')!
  let eid = eidOf(wren.id)
  await g.apply([{
    entity: { eid },
    villager: { id: wren.id, level: wren.level, role: 'elder' },
  }])
  await g.apply([characters.find((row) => row.entity.eid == eid)!])
  let [saved] = await g.read(`.entity.eid=${eid}&.villager&.character`)
  assertEquals(comp(saved, 'villager').role, 'elder')
  assertEquals(comp(saved, 'villager').level, wren.level)
  assertEquals(comp(saved, 'character').story, characters[0].character.story)

  let installed = graph({ storage: ram(vocab), vocab })
  await installed.apply([characters.find((row) => row.entity.eid == eid)!])
  await installed.apply([{
    entity: { eid },
    villager: { id: wren.id, level: wren.level },
  }])
  let [born] = await installed.read(`.entity.eid=${eid}&.villager&.character`)
  assertEquals(comp(born, 'villager').level, wren.level)
  assertEquals(comp(born, 'character').story, characters[0].character.story)
})

test('a villager speaks from graph character details', () => {
  let wren = GIVERS.find((g) => g.id == 'wren')!
  let row = characters.find((row) => row.entity.eid == eidOf(wren.id))!
  let words = persona(wren, {
    hero: { eid: 'hero', name: 'Tansy', lvl: 2 },
    people: new Map([[
      wren.id,
      { ...aboutOf(wren), ...characterOf(row.character) },
    ]]),
    holds: new Map(),
    bag: new Map(),
    dealt: [],
    quests: [],
    deeds: [],
    here: [],
  })
  assertStringIncludes(words, row.character.story)
  assertStringIncludes(words, row.character.traits.join(', '))
})
