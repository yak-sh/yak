// Command names find the current hero, villager or land, with ids for
// ambiguous names and ephemeral entities.
import { assertEquals, assertRejects } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import type { Bundle } from './net.ts'
import { comp } from './bundle.ts'
import { eidOf } from './villagers.ts'
import { resolveTarget } from './target.ts'
import words from './vocab.json' with { type: 'json' }

let row = (eid: string, player: string, name: string, at: number): Bundle => ({
  entity: { eid },
  look: { player, name, at },
})

Deno.test('command target names choose lands, villagers, and current heroes', async () => {
  let looks = [
    row('old', 'hero-1', 'Bramble', 1),
    row('new', 'hero-1', 'Hazel', 2),
    row('other', 'hero-2', 'Bramble', 3),
  ]
  let query = (line: string) =>
    Promise.resolve(
      line.startsWith('.look.name~=')
        ? looks.filter((b) =>
          String(comp(b, 'look').name).toLowerCase().includes('bramble')
        )
        : looks,
    )
  assertEquals(await resolveTarget('Tomb Sands', query), {
    level: 'tombsands',
  })
  assertEquals(await resolveTarget('frontier_20_20', query), {
    level: 'frontier_20_20',
  })
  assertEquals(await resolveTarget('Elder Wren', query), {
    eid: eidOf('wren'),
  })
  assertEquals(await resolveTarget('Bramble', query), { eid: 'hero-2' })
  assertEquals(await resolveTarget('Nobody', () => Promise.resolve([])), null)
})

Deno.test('command target refuses ambiguous current hero names', async () => {
  let looks = [
    row('a', 'hero-1', 'Bramble', 1),
    row('b', 'hero-2', 'Bramble', 2),
  ]
  await assertRejects(
    () => resolveTarget('Bramble', () => Promise.resolve(looks)),
    Error,
    'use an eid',
  )
  let uuid = '01234567-89ab-cdef-0123-456789abcdef'
  assertEquals(
    await resolveTarget(uuid, () => {
      throw Error('id should not query names')
    }),
    { eid: uuid },
  )
})

Deno.test('command name queries parse spaces and ampersands in graph', async () => {
  let vocab = loadVocab([words])
  let g = graph({ storage: ram(vocab), vocab })
  let hero = '01234567-89ab-cdef-0123-456789abcdef'
  await g.apply([
    { entity: { eid: hero }, player: {} },
    {
      entity: { eid: 'first' },
      look: { player: hero, name: 'Pip & Wren', at: 1 },
    },
    {
      entity: { eid: 'second' },
      look: { player: hero, name: 'Pip & Hazel', at: 2 },
    },
  ])
  let query = async (line: string) => await g.read(line)
  assertEquals(await resolveTarget('Pip & Wren', query), null)
  assertEquals(await resolveTarget('Pip & Hazel', query), { eid: hero })
})
