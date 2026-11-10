import { checked } from './store.ts'
import { token } from '@yaks/graph/sha256'
import { type Order, type Patch, type Repository } from './fulfillment.ts'

export type Store = {
  fetch: (path: string, init?: RequestInit) => Promise<Response>
}

export let query = async <T>(store: Store, line: string): Promise<T[]> => {
  let response = await store.fetch(`/query?q=${encodeURIComponent(line)}`)
  return (await checked(response, 'PrintBound graph read failed')).json()
}

export let apply = async (store: Store, entities: unknown[]) => {
  let response = await store.fetch('/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entities }),
  })
  await checked(response, 'PrintBound graph write failed')
}

/** Compare-and-set conflicts mean another continuation already progressed. */
export let compare = async (
  store: Store,
  entities: unknown[],
): Promise<boolean> => {
  let response = await store.fetch('/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entities }),
  })
  if (response.ok) return true
  let body = response.status === 409 ? await response.clone().json() : null
  if (
    response.status === 409 &&
    (body.error?.name === 'Stale' || body.error === 'Stale')
  ) return false
  await checked(response, 'PrintBound guarded write failed')
  return false
}

export let repository = (store: Store): Repository => ({
  read: async (id) => {
    let [order] = await query<Order>(store, `.entity.eid=${id}`)
    if (!order?.print_order) throw new Error('Print order is missing')
    return order
  },
  patch: (id: string, patch: Patch) =>
    apply(store, [{ entity: { eid: id }, ...patch }]),
  receipt: (id, receipt, previous) =>
    compare(store, [{
      entity: { eid: id },
      print_receipt: receipt,
      $was: {
        print_receipt: {
          status: token(previous?.status),
          changed: token(previous?.changed),
        },
      },
    }]),
  claim: async (id, intent, previous) => {
    let response = await store.fetch('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entities: [{
          entity: { eid: id },
          print_submission: intent,
          $was: {
            print_submission: {
              reference: token(previous?.reference),
              attempt: token(previous?.attempt),
            },
          },
        }],
      }),
    })
    if (response.ok) return true
    // Only a compare-and-set loser is expected. A closed graph or malformed
    // write remains a failure and reaches the platform reporter.
    let body = response.status === 409 ? await response.clone().json() : null
    if (
      response.status === 409 &&
      (body.error?.name === 'Stale' || body.error === 'Stale')
    ) return false
    await checked(response, 'PrintBound submission claim failed')
    return false
  },
})
