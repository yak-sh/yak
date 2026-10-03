// A migration preserves authored conditions and refuses competing edits.
import { equal, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import words from './vocab.json' with { type: 'json' }
import wake from '../../packages/wake/vocab.json' with { type: 'json' }
import { wakeMove } from './position-move.ts'

test('villager wake migration preserves other schedules, is guarded and idempotent', async () => {
  let vocab = loadVocab([words, wake])
  let g = graph({ storage: ram(vocab), vocab })
  let row = {
    entity: { eid: 'villager' },
    villager: { id: 'pip', level: 'mossvale' },
    wake: {
      while: [
        { match: '.seen.level=mossvale&.seen.at>=5-minutes-ago', every: '5m' },
        { match: '.player', every: '1h' },
      ],
    },
  }
  await g.apply([row])
  let patch = wakeMove(await g.read('.villager ?wake'))
  await g.apply(patch)
  let moved = await g.read('.villager ?wake')
  equal((moved[0].wake as typeof row.wake).while, [
    { match: '.player&.position.level=mossvale', every: '5m' },
    row.wake.while[1],
  ])
  equal(wakeMove(moved), [])
  await g.apply([row])
  let before = wakeMove(await g.read('.villager ?wake'))
  let authored: Bundle[] = [{ entity: row.entity, wake: { while: [] } }]
  await g.apply(authored)
  let refused = false
  try {
    await g.apply(before)
  } catch {
    refused = true
  }
  equal(refused, true)
})
