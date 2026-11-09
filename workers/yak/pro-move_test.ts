// Stored plans move once without touching subscriptions or sign-in data.
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { type Comp, graph, mint, Stale } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { platformDoc } from '@yaks/platform/vocab'
import { proRule } from './pro-move.ts'

let vocab = loadVocab([kernelDoc, {
  $defs: {
    plan: platformDoc.$defs!.plan,
    credential: {
      component: true,
      type: 'object',
      properties: { token: { type: 'string' } },
    },
  },
}])
let fixture = () => {
  let storage = ram(vocab)
  let rows = ['organization', 'plus', 'free', 'pro'].map((tier) => ({
    entity: { eid: mint() },
    plan: {
      tier,
      customer: 'cus_kept',
      subscription: 'sub_kept',
      status: 'active',
      until: '2026-12-01T00:00:00.000Z',
      ending: '2026-12-01T00:00:00.000Z',
      at: '2026-11-01T00:00:00.000Z',
    },
    credential: { token: 'kept' },
  }))
  // Stored rows came from the previous vocabulary, before Pro was named.
  storage.tx((tx) => tx.patch(rows))
  return { g: graph({ vocab, storage }), rows }
}
let kept = fixture(), changed = fixture()
let move = async (g: typeof kept.g) => {
  let rows = await g.read(proRule.find)
  await g.apply(rows.flatMap((row) => proRule.move(row)), { trusted: true })
  return rows.length
}

test('the tier moves once, retaining billing and credentials', async () => {
  let { g, rows } = kept
  equal([await move(g), await move(g)], [1, 0])
  for (let row of rows) {
    let [got] = await g.read(`.entity.eid=${row.entity.eid}&?plan&?credential`)
    equal(got.plan, {
      ...row.plan,
      tier: row.plan.tier == 'organization' ? 'pro' : row.plan.tier,
    })
    equal(got.credential, row.credential)
    equal(proRule.move(got), [])
  }
})

test('a subscription changed since the move read it is left to its writer', async () => {
  let { g } = changed
  let [row] = await g.read(proRule.find)
  await g.apply([{
    entity: row.entity,
    plan: { tier: 'plus' },
  }], { trusted: true })
  await assertRejects(
    async () => await g.apply(proRule.move(row), { trusted: true }),
    Stale,
  )
  equal((await g.read(`.entity.eid=${row.entity.eid}&?plan`))[0].plan, {
    ...row.plan as Comp,
    tier: 'plus',
  })
})
