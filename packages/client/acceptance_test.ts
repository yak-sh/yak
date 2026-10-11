// A mutation's visible edit and its accepted receipt are different events.
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { client } from './client.ts'
import { WriteRefused, WriteUnknown } from './mod.ts'
import { box, comp } from './testing.ts'

let vocab = loadVocab([...box.docs, {
  $defs: {
    cooked: { component: true, type: 'object', properties: {} },
    cook: { rule: true, match: '.recipe +!cooked' },
  },
}])
let server = graph({ vocab, storage: ram(vocab), actor: { by: 'cook' } })
let gate = Promise.withResolvers<void>()
let requested = Promise.withResolvers<void>()
let write: Bundle[] = [{ entity: { eid: 'dal' }, recipe: { serves: 4 } }]
let accepted = await server.apply(write)
let delayed = client(box, [], {
  url: 'http://box.test',
  vault: false,
  wireVault: false,
  fetch: async (request) => {
    requested.resolve()
    await gate.promise
    equal(await request.json(), write)
    return Response.json(write)
  },
})

test('ordinary mutation shows optimistically but waits for server acceptance', async () => {
  let settled = false
  let pending = Promise.resolve(delayed.mutate(write)).then((receipt) => {
    settled = true
    return receipt
  })
  equal(comp(delayed.ent('dal'), 'recipe').serves, 4)
  await requested.promise
  equal(settled, false)
  gate.resolve()
  equal(await pending, write)
  delayed.close()
})

let stamped = client(box, [], {
  url: 'http://box.test',
  vault: false,
  wireVault: false,
  fetch: () => Response.json(accepted),
})
test('ordinary mutation returns server rules and stamps', async () => {
  let receipt = await stamped.mutate(write)
  equal(receipt, accepted)
  equal(receipt[0].cooked, {})
  equal(comp(receipt[0], 'created').by, 'cook')
  stamped.close()
})

let refused = client(box, [], {
  url: 'http://box.test',
  vault: false,
  wireVault: false,
  report: () => {},
  fetch: () =>
    Response.json({ error: 'Refused', message: 'not a writer' }, {
      status: 403,
    }),
})

test('ordinary mutation rejects deliberate refusal and restores server fields', async () => {
  let pending = Promise.resolve(refused.mutate([{
    entity: { eid: 'dal' },
    doc: { title: 'Dal' },
    draft: { text: 'saved input' },
  }]))
  equal(comp(refused.ent('dal'), 'doc').title, 'Dal')
  let error = await assertRejects(() => pending, WriteRefused)
  equal(error.outcome, 'refused')
  equal(error.refusal.error, 'Refused')
  equal(comp(refused.ent('dal'), 'doc'), {})
  equal(comp(refused.ent('dal'), 'draft').text, 'saved input')
  refused.close()
})

for (
  let [name, response] of [
    ['lost response', () => {
      throw new Error('offline')
    }],
    ['broken response body', () => new Response('[')],
    ['server fault', () => new Response('fault', { status: 500 })],
    ['pending response', () => Response.json([], { status: 202 })],
  ] as const
) {
  let c = client(box, [], {
    url: 'http://box.test',
    vault: false,
    wireVault: false,
    report: () => {},
    fetch: response,
  })
  test(`ordinary mutation reports unknown outcome on ${name} and keeps its edit`, async () => {
    let pending = Promise.resolve(
      c.mutate([{ entity: { eid: 'dal' }, doc: { title: 'Dal' } }]),
    )
    let error = await assertRejects(() => pending, WriteUnknown)
    equal(error.outcome, 'unknown')
    equal(error.sent, [{ entity: { eid: 'dal' }, doc: { title: 'Dal' } }])
    equal(comp(c.ent('dal'), 'doc').title, 'Dal')
    c.close()
  })
}
