// The back office over a shop's store, as its editor uses it: the store is
// the client's names over rows in memory (`store(env.STORE)` on a page), and
// the page is a linkedom document.
import { equal, test, until } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { open } from './office.js'

let TEE = '0f8fad5b-d9cb-469f-a165-70867728950e'
let DEFS = {
  product: {
    properties: {
      price_cents: { type: 'integer' },
      sizes: { type: 'string' },
      stock: { type: 'integer' },
      image: { type: 'string', format: 'uri' },
    },
  },
  order: { properties: { total_cents: { type: 'integer', stamped: true } } },
  print_receipt: {
    description: 'The provider’s last print receipt.',
    properties: {
      status: { type: 'string' },
      tracking: { type: 'array', items: { type: 'string' } },
    },
  },
}
let ROWS = [
  {
    entity: { eid: TEE },
    doc: { title: 'Everyday Tee' },
    product: { price_cents: 2800, sizes: 'S, M', stock: 4 },
    created: { at: '2026-11-01T10:00:00Z' },
  },
  {
    entity: { eid: 'o-ana' },
    order: {
      items: JSON.stringify([{ p: TEE.replaceAll('-', ''), q: 2, o: 'M' }]),
      total_cents: 5600,
      email: 'ana@example.com',
      status: 'paid',
    },
    created: { at: '2026-11-20T10:00:00Z' },
  },
  {
    entity: { eid: 'o-book' },
    order: {
      quote: 'q1',
      quantity: 3,
      total_cents: 9000,
      refunded_cents: 9000,
      email: 'ben@example.com',
      status: 'refunded',
    },
    print_receipt: {
      status: 'SHIPPED',
      tracking: ['https://track.example/1'],
    },
    created: { at: '2026-11-21T10:00:00Z' },
  },
  {
    entity: { eid: 'r1' },
    refund_request: { order: 'o-book', reason: 'Lost', status: 'refunded' },
    created: { at: '2026-11-22T10:00:00Z' },
  },
]

// The rows a filter names, the way the store answers the few the page asks.
let answer = (rows: Record<string, unknown>[], filter: string) => {
  let id = /^id=([^&]+)&/.exec(filter)?.[1]
  if (id) return rows.filter((r) => (r.entity as { eid: string }).eid == id)
  let refunds = /^\.refund_request\.order=([^&]+)/.exec(filter)?.[1]
  if (refunds) {
    return rows.filter((r) =>
      (r.refund_request as { order?: string })?.order == refunds
    )
  }
  let word = /^\.([a-z_]+)&/.exec(filter)?.[1]
  return word ? rows.filter((r) => r[word]).toReversed() : []
}

let office = (writes = true) => {
  let rows = structuredClone(ROWS) as Record<string, unknown>[]
  let applied: unknown[] = []
  let paid: unknown[] = []
  let busy = 0
  // Each call answers a turn later, as a store's does, and is counted.
  let held = <A extends unknown[], T>(f: (...a: A) => T) => (...a: A) => {
    busy++
    return Promise.resolve().then(() => f(...a)).finally(() => busy--)
  }
  let settled = () => until(() => busy == 0, { label: 'the page’s calls' })
  let { document } = parseHTML(
    '<!doctype html><html><body><main id="office"></main></body></html>',
  )
  let root = document.getElementById('office')!
  let hear: () => unknown = () => {}
  let view = {
    location: { hash: '' },
    addEventListener: (_: string, fn: () => unknown) => hear = fn,
  }
  let shop = {
    me: held(() => ({ person: 'u-jo', writes })),
    words: held(() => DEFS),
    drafts: () => null,
    query: held((f: string) => answer(rows, f)),
    apply: held((bundles: Record<string, unknown>[]) => {
      applied.push(...bundles)
      return { ok: true }
    }),
    pay: held((path: string, body: unknown) => {
      paid.push([path, body])
      return { refund: 'r2', status: 'requested' }
    }),
    upload: held(() => ({ eid: 'sha' })),
  }
  let go = async (hash: string) => {
    view.location.hash = hash
    await hear()
    await settled()
  }
  // A save that moves the page on changes its hash, which a browser hears.
  let submit = async () => {
    let was = view.location.hash
    root.querySelector('form')!.dispatchEvent(
      new document.defaultView!.Event('submit', { cancelable: true }),
    )
    await settled()
    if (view.location.hash != was) await hear()
    await settled()
  }
  return {
    applied,
    paid,
    go,
    submit,
    start: async () => {
      await open({
        root,
        shop,
        view,
        files: '/shop/api/blob/',
        home: 'https://ada.yaks.app/shop/',
        uuid: () => 'req-1',
      })
      await settled()
    },
    field: (name: string) =>
      root.querySelector(`[name="${name}"]`) as HTMLInputElement,
    names: () =>
      [...root.querySelectorAll('.Rows_Name')].map((r) => r.textContent),
    text: () => root.textContent,
  }
}

test('the orders list each sale newest first with what its shop keeps on it', async () => {
  let o = office()
  await o.start()
  equal(o.names(), ['ben@example.com', 'ana@example.com'])
  equal(o.text().includes('Refunded · Print receipt: SHIPPED'), true)
  await o.go('#orders/paid')
  equal(o.names(), ['ana@example.com'])
})

test('an order shows its lines, its totals and the other words its shop wrote', async () => {
  let o = office()
  await o.start()
  await o.go('#order/o-ana')
  equal(o.names(), ['Everyday Tee (M)'])
  equal(o.text().includes('× 2 · $56.00'), true)
  await o.go('#order/o-book')
  equal(o.names().slice(0, 1), ['Printed document'])
  let text = o.text()
  equal(text.includes('Print receipt'), true)
  equal(text.includes('SHIPPED'), true)
  equal(text.includes('https://track.example/1'), true)
  equal(text.includes('Nothing is left to refund.'), false)
  equal(text.includes('refunded · Lost'), true)
})

test('a refund asks the shop’s payment door for the amount typed, or all that is left', async () => {
  let o = office()
  await o.start()
  await o.go('#order/o-ana')
  o.field('amount').value = '100'
  await o.submit()
  equal(o.paid, [])
  equal(o.text().includes('Refund an amount up to $56.00.'), true)
  o.field('amount').value = '12.50'
  o.field('reason').value = 'Wrong size'
  await o.submit()
  o.field('amount').value = ''
  await o.submit()
  equal(o.paid, [
    ['refunds', {
      request: 'req-1',
      order: 'o-ana',
      amount: 1250,
      reason: 'Wrong size',
    }],
    ['refunds', { request: 'req-1', order: 'o-ana', reason: undefined }],
  ])
})

test('customers are the people on orders, the biggest spender first', async () => {
  let o = office()
  await o.start()
  await o.go('#customers')
  equal(o.names(), ['ana@example.com', 'ben@example.com'])
  await o.go(`#customer/${encodeURIComponent('ana@example.com')}`)
  equal(o.names(), ['ana@example.com'])
})

test('a product is edited with the data editor’s form, its price in cents', async () => {
  let o = office()
  await o.start()
  await o.go('#products')
  equal(o.names(), ['Everyday Tee'])
  await o.go(`#product/${TEE}`)
  equal(o.text().includes('Whole cents: 2800 is $28.00.'), true)
  o.field('product.stock').value = '3'
  await o.submit()
  equal(o.applied, [{ entity: { eid: TEE }, product: { stock: 3 } }])
  equal(o.names(), ['Everyday Tee'])
})

test('someone who is not the shop’s editor is told, not shown an empty shop', async () => {
  let o = office(false)
  await o.start()
  equal(o.names(), [])
  equal(o.text().includes('Only the shop’s owners and editors'), true)
})
