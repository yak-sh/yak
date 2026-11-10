import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import manifest from './vocab.json' with { type: 'json' }

// Only the graph facts consumed by the declared payment rule are needed here;
// the app-door journey covers payment and order privacy separately.
let vocab = loadVocab({
  $defs: {
    order: {
      component: true,
      properties: { quote: { type: 'string', ref: 'entity' } },
    },
    print_order: { component: true, properties: {} },
    print_expired: { component: true, properties: {} },
    print_payment_seen: { component: true, properties: {} },
    tool: { component: true, properties: { name: { type: 'string' } } },
    call: {
      component: true,
      properties: {
        to: { type: 'string' },
        source: { type: 'string' },
      },
    },
  },
})

test('late verified payment queues its expired print order once despite duplicate callbacks', async () => {
  let g = graph({
    vocab,
    storage: ram(vocab),
    plugins: [{
      name: 'payment',
      declared: [{
        name: 'print_payment_ready',
        match: manifest.$defs.print_payment_ready.match,
      }],
    }],
  })
  g.install()
  let order = crypto.randomUUID(),
    payment = crypto.randomUUID(),
    step = crypto.randomUUID()
  await g.apply([
    { entity: { eid: order }, print_order: {}, print_expired: {} },
    { entity: { eid: step }, tool: { name: 'print_step' } },
  ])
  equal((await g.read('.call')).length, 0)
  let callback = [{ entity: { eid: payment }, order: { quote: order } }]
  await g.apply(callback)
  let [queued] = await g.read('.call')
  equal(queued.call, { to: step, source: order })
  await g.apply(callback)
  await g.apply(callback)
  equal((await g.read('.call')).map((row) => row.entity.eid), [
    queued.entity.eid,
  ])
  equal((await g.read('.print_payment_seen')).map((row) => row.entity.eid), [
    payment,
  ])
})
