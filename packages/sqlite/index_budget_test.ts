// Numberless stores cannot use a second ordering index on absent numbers.
import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { archetypeDoc } from '@yaks/archetype'
import { storage } from './mod.ts'
let indexes = (d: ReturnType<typeof mem>, table: string) =>
  d.query({ t: 'pragma', name: 'index_list', arg: table }).map((r) =>
    String(r.name)
  )
import { mem } from './testing.ts'
test('numberless archetype stores keep one candidate index across repeated installs', () => {
  let v = loadVocab([archetypeDoc])
  let d = mem(), s = storage(d, v)
  s.install()
  equal(
    indexes(d, 'entity').filter((name) => name.startsWith('entity_archetype')),
    ['entity_archetype'],
  )
  s.install()
  equal(
    indexes(d, 'entity').filter((name) => name.startsWith('entity_archetype')),
    ['entity_archetype'],
  )
})
