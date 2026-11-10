import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { apply, compare, query, repository, type Store } from './orders.ts'
import { json, Refusal } from './store.ts'

for (
  let [name, run] of [
    ['read', (store) => query(store, '.print_preparation')],
    ['write', (store) => apply(store, [])],
    ['guarded write', (store) => compare(store, [])],
    ['submission claim', (store) =>
      repository(store).claim('order', {
        at: 'now',
        reference: 'reference',
        attempt: 'attempt',
      })],
  ] satisfies [string, (store: Store) => Promise<unknown>][]
) {
  test(`a failed graph ${name} keeps its upstream diagnostic without changing its grouping message`, async () => {
    for (let requestId of ['first', 'second']) {
      let body = `upstream failure for ${requestId}`
      let error = await assertRejects(
        () =>
          run({
            fetch: () =>
              Promise.resolve(
                new Response(body, {
                  status: 500,
                  headers: { 'x-request-id': requestId },
                }),
              ),
          }),
        Error,
        `PrintBound ${
          ['submission claim', 'guarded write'].includes(name)
            ? name
            : `graph ${name}`
        } failed`,
      )
      assertEquals(error.cause, { status: 500, requestId, body })
      assertEquals(error.message.includes(requestId), false)
      assertEquals(error instanceof Refusal, false)
    }
  })
}

test('graph refusal and stale guarded-write behavior survive diagnostic decoding', async () => {
  let refused = await assertRejects(
    () =>
      json(
        new Response('not yours', {
          status: 403,
        }),
      ),
    Refusal,
    'not yours',
  ) as Refusal
  assertEquals(refused.status, 403)
  assertEquals(
    await compare({
      fetch: () =>
        Promise.resolve(Response.json({ error: { name: 'Stale' } }, {
          status: 409,
        })),
    }, []),
    false,
  )
  await apply({
    fetch: () => Promise.resolve(new Response(null, { status: 204 })),
  }, [])
})
