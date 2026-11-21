// A hold made before holds expired is given an expiry an hour on and a likely
// cost of nothing; one made since, or one that already expires, is left alone.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { docs } from '@yaks/platform/meter-vocab'
import { holdExpiryRule } from './hold-expiry-move.ts'

let comp = (props: Record<string, { type: string }> = {}) => ({
  component: true,
  type: 'object',
  properties: props,
})
let vocab = loadVocab([kernelDoc, ...docs, {
  $defs: { space: comp(), created: comp({ at: { type: 'string' } }) },
}])
let g = graph({ vocab, storage: ram(vocab) })
let hold = (eid: string, at: string, more = {}) => ({
  entity: { eid },
  model_reservation: { month: '2026-11', dollars: 5, what: 'models', ...more },
  created: { at },
})
await g.apply([
  hold('old', '2026-11-20T03:07:00.000Z'),
  hold('expiring', '2026-11-20T03:07:00.000Z', {
    likely: 0.1,
    until: '2026-11-20T04:07:00.000Z',
  }),
  hold('owned', '2026-11-21T04:00:00.000Z'),
], { trusted: true, stamp: false })

test('a hold made before holds expired expires an hour on, at nothing', async () => {
  let rows = await g.read(holdExpiryRule.find)
  await g.apply(rows.flatMap((row) => holdExpiryRule.move(row)), {
    trusted: true,
    stamp: false,
  })
  let held = Object.fromEntries(
    (await g.read('.model_reservation')).map((r) => {
      let h = r.model_reservation as Record<string, unknown>
      return [r.entity.eid, [h.dollars, h.likely ?? null, h.until ?? null]]
    }),
  )
  assertEquals(held, {
    old: [5, 0, '2026-11-20T04:07:00.000Z'],
    expiring: [5, 0.1, '2026-11-20T04:07:00.000Z'],
    owned: [5, null, null],
  })
})
