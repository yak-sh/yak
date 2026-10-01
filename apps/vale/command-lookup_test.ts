import { client } from '@yaks/client'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { commandLookup } from './command-lookup.ts'
import { seedDesigns } from './designs_fixture.ts'
import { LEVELS } from './levels.ts'
import type { Bundle } from './net.ts'
import { GIVERS } from './quests.ts'
import { creatureNamed } from './spawn.ts'
import { resolveTarget } from './target.ts'
import { eidOf } from './villager-id.ts'

seedDesigns()

let vocab = loadVocab([{
  $defs: {
    beast_design: {
      component: true,
      type: 'object',
      properties: { name: { type: 'string' } },
    },
    alias: { component: true, type: 'object', properties: {} },
    key: {
      component: true,
      type: 'object',
      properties: { of: { type: 'string' }, value: { type: 'string' } },
    },
    position: {
      component: true,
      type: 'object',
      properties: { x: { type: 'number' }, z: { type: 'number' } },
    },
  },
}])
let beast = (eid: string, name: string): Bundle => ({
  entity: { eid },
  beast_design: { name },
})
let alias = (eid: string, of: string, value: string): Bundle => ({
  entity: { eid },
  alias: {},
  key: { of, value },
})
let page = () => client(vocab, [], { vault: false, wireVault: false })

test('creature suggestions offer only names and aliases execution can resolve', async () => {
  let c = page()
  let refs = commandLookup({ client: c })
  let beasts = [
    beast('b1', 'Bog Slime'),
    beast('b2', 'bog-slime'),
    beast('b3', 'Bristleboar'),
    beast('b4', 'beast:boar'),
    beast('b5', '!!!'),
  ]
  let keys = [
    alias('k1', 'b1', 'beast:slime'),
    alias('k2', 'b2', 'marsh:slime'),
    alias('k3', 'b3', 'beast:boar'),
    alias('k4', 'b3', 'woods:pig'),
    alias('k5', 'missing', 'beast:ghost'),
    alias('k6', 'b3', 'other:boar'),
  ]
  try {
    await c.mutate([...beasts, ...keys])
    let words = refs.lookup.ids('beast_design')
    for (let word of words) ok(creatureNamed(word, beasts, keys))
    for (
      let word of [
        'Bog Slime',
        'bog-slime',
        'slime',
        'beast:boar',
        '!!!',
        'ghost',
        'beast:ghost',
      ]
    ) {
      ok(!words.includes(word), word)
    }
    for (
      let word of [
        'b1',
        'b2',
        'b3',
        'b4',
        'b5',
        'beast:slime',
        'marsh:slime',
        'Bristleboar',
        'woods:pig',
        'pig',
        'boar',
      ]
    ) {
      ok(words.includes(word), word)
    }
    equal(words.filter((word) => word == 'boar').length, 1)
    equal(refs.lookup.ids('unknown'), [])
  } finally {
    refs.close()
    c.close()
  }
})

test('creature suggestions follow renames, alias changes and removals', async () => {
  let c = page()
  let refs = commandLookup({ client: c })
  try {
    await c.mutate([
      beast('b1', 'Pip'),
      beast('b2', 'pip'),
      alias('k1', 'b1', 'beast:pip'),
    ])
    ok(!refs.lookup.ids('beast_design').includes('Pip'))
    await c.mutate([beast('b2', 'Wren')])
    ok(refs.lookup.ids('beast_design').includes('Pip'))
    await c.mutate([alias('k1', 'b1', 'beast:wren')])
    ok(!refs.lookup.ids('beast_design').includes('Wren'))
    ok(!refs.lookup.ids('beast_design').includes('beast:pip'))
    await c.mutate([{ entity: { eid: 'b1' }, $delete: true }])
    equal(refs.lookup.ids('beast_design'), ['b2', 'Wren'])
    await c.mutate([{ entity: { eid: 'k1' }, $delete: true }])
    equal(refs.lookup.ids('beast_design'), ['b2', 'Wren'])
    equal(c.watches.size(), 3)
    refs.close()
    equal(c.watches.size(), 0)
    refs.close()
    equal(c.watches.size(), 0)
  } finally {
    refs.close()
    c.close()
  }
})

test('place suggestions retain position eids and use accepted land and villager names', async () => {
  let c = page()
  let refs = commandLookup({ client: c })
  let eid = '01234567-89ab-cdef-0123-456789abcdef'
  let noNames = () => {
    throw Error('static destinations should not query hero names')
  }
  try {
    await c.mutate([{ entity: { eid }, position: { x: 1, z: 2 } }])
    let places = refs.lookup.ids('position')
    ok(places.includes(eid))
    equal(await resolveTarget(eid, noNames), { eid })
    for (let giver of GIVERS) {
      for (let word of [giver.id, giver.name]) {
        ok(places.includes(word), word)
        equal(await resolveTarget(word, noNames), { eid: eidOf(giver.id) })
      }
    }
    let lands = refs.lookup.ids('theme_design')
    for (let level of Object.values(LEVELS)) {
      for (let word of [level.id, level.name]) {
        ok(lands.includes(word), word)
        equal(await resolveTarget(word, noNames), { level: level.id })
      }
    }
    await c.mutate([{ entity: { eid }, position: null }])
    ok(!refs.lookup.ids('position').includes(eid))
  } finally {
    refs.close()
    c.close()
  }
})
