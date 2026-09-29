// Creature designs enter through the app store and shape the world on a page.
import { assert, assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { BEASTS, useBeasts } from './beasts.ts'
import { rows } from './beasts_fixture.ts'
import { clearHomes, dens } from './homes.ts'
import { LEVELS } from './levels.ts'
import { uuidOf } from './rand.ts'
import words from './vocab.json' with { type: 'json' }

Deno.test('a creature design added to the store inhabits its chosen land', async () => {
  let vocab = loadVocab([words])
  let g = graph({ storage: ram(vocab), vocab })
  await g.apply(rows)
  useBeasts(await g.read('.beast_design'))
  clearHomes()
  assertEquals(Object.keys(BEASTS).length, rows.length)

  let slime = rows.find((row) => row.beast_design.kind == 'slime')!
  let eid = uuidOf('mossvale/beast/moonmoth')
  await g.apply([{
    entity: { eid },
    beast_design: { ...slime.beast_design, kind: 'moonmoth', name: 'Moonmoth' },
  }])
  useBeasts(await g.read('.beast_design'))
  clearHomes()
  assert(dens(LEVELS.mossvale).some((den) => den.kind == 'moonmoth'))

  await g.apply([{ entity: { eid }, beast_design: { haunts: [] } }])
  useBeasts(await g.read('.beast_design'))
  clearHomes()
  assertEquals(
    dens(LEVELS.mossvale).some((den) => den.kind == 'moonmoth'),
    false,
  )
})
